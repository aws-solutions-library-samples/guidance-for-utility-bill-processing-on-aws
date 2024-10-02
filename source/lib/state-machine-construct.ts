import * as cdk from "aws-cdk-lib";
import { Duration } from "aws-cdk-lib";
import { FoundationModel, FoundationModelIdentifier } from "aws-cdk-lib/aws-bedrock";
import { Effect, PolicyStatement, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Key } from "aws-cdk-lib/aws-kms";
import { Architecture, Runtime, RuntimeFamily, Tracing, Function } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { LogGroup } from "aws-cdk-lib/aws-logs";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { Queue } from "aws-cdk-lib/aws-sqs";
import * as lambda from 'aws-cdk-lib/aws-lambda';
import {
  LogLevel,
  StateMachine,
  CustomState,
  DefinitionBody,
  Pass,
  JsonPath,
  TaskInput
} from "aws-cdk-lib/aws-stepfunctions";
import * as tasks from "aws-cdk-lib/aws-stepfunctions-tasks";
import { Construct } from "constructs";
import path = require("path");

export interface StateMachineProps {
  dlq: Queue;
  bucket: Bucket;
}

// Change Bedrock Model by customizing this string.  See https://docs.aws.amazon.com/bedrock/latest/userguide/model-ids.html
const MODEL_ID = 'anthropic.claude-3-sonnet-20240229-v1:0'

/**
 * Creates a state machine in AWS Step Functions for processing
 * utility bill invoices into a standardized format.
 * See the project README for a depiction of the state machine
 * once deployed.
 * The state machine includes two AWS Lambda functions. The
 * startQueriesFunction checks if additional queries are present
 * to fetch deeper insights from the utility bill. The
 * invoicePostProcessingFunction applies the results of all
 * Amazon Textract results and outputs the standardized data.
 */
export class InvoiceStateMachine extends Construct {
  public readonly stateMachine: StateMachine;

  constructor(scope: Construct, id: string, props: StateMachineProps) {
    super(scope, id);

    
    const bedrockModelArn =  FoundationModel.fromFoundationModelId(this, 'BedrockFMId', new FoundationModelIdentifier(MODEL_ID)).modelArn

    // import file prompt.txt into variable promptText
    const promptText = require('fs').readFileSync(path.join(__dirname, '../prompt.txt'), 'utf8');

    const pdfToImageFunction = new Function(this, "PdfToImageFunction", {
      memorySize: 3008,
      timeout: cdk.Duration.minutes(3),
      runtime: Runtime.PYTHON_3_12,
      handler: "index.handler",
      code: cdk.aws_lambda.Code.fromAsset(
        path.join(__dirname, "/../packages/pdfToImage"), {
          bundling: {
            image:  (new Runtime('python3.12:latest-x86_64', RuntimeFamily.PYTHON)).bundlingImage,
            command: [
              'bash', '-c', [
                'pip install -r requirements.txt -t /asset-output',
                'cp -r /asset-input/* /asset-output/'
              ].join(' && ')
            ]
          }
        }
      ),
      tracing: Tracing.ACTIVE,
    });

    props.bucket.grantRead(pdfToImageFunction, 'input/*');
    props.bucket.grantWrite(pdfToImageFunction, 'wip/*');


    const prepBedrockInputFunction = new NodejsFunction(this, "BedrockInputFunction", {
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: "handler",
      entry: path.join(__dirname, "/../packages/bedrockInput/index.ts"),
      tracing: Tracing.ACTIVE,
      environmentEncryption: new Key(this, "StartQueriesFunctionKey", {
        enableKeyRotation: true,
      }),
      environment: {
        "BUCKET_NAME": props.bucket.bucketName,
        "DEFAULT_PROMPT_TEXT": promptText
      }
    });

    props.bucket.grantReadWrite(prepBedrockInputFunction, 'wip/*')

    const pdfToImageTask = new tasks.LambdaInvoke(this, 'convertPDF', {
      lambdaFunction: pdfToImageFunction,
      payloadResponseOnly: true,
      resultPath: '$.images'
    })

    const prepBedrockInputTask = new tasks.LambdaInvoke(this, 'prepBedrockInputTask', {
      lambdaFunction: prepBedrockInputFunction,
      payloadResponseOnly: true,
    })

    
    const callBedrockTask = new CustomState(this, 'callBedrock', {
      stateJson: {
        Type: 'Task',
        Resource: 'arn:aws:states:::bedrock:invokeModel',
        Parameters: {
          ModelId: bedrockModelArn,
          Input: {
            "S3Uri.$": "States.Format('s3://{}/{}', $.Bucket, $.Key)",
          }
        },
        OutputPath: '$.Body'
      }
    })

    const extractBedrockResult = new Pass(this, 'extractBedrockResult', {
      parameters: {
        result: JsonPath.stringToJson(JsonPath.stringAt("$.content[0].text")),
        metadata: JsonPath.executionInput
      },
    })

    const writeToS3 = new tasks.CallAwsService(this, "writeToS3", {
      service: "s3",
      action: "putObject",
      parameters: {
        Body: TaskInput.fromJsonPathAt("$.result").value,
        Bucket: props.bucket.bucketName,
        Key: JsonPath.format('output/{}.json', JsonPath.uuid())
      },
      iamResources: [props.bucket.arnForObjects("output/*")],
      resultPath: JsonPath.DISCARD
    })

    const publishEvent = new tasks.EventBridgePutEvents(this, "publishEvent", {
      entries: [
        {
          detail: TaskInput.fromJsonPathAt('$'),
          detailType: "UtilityBillProcessed",
          source: "invoice-to-insights"
        }
      ],
      resultPath: JsonPath.DISCARD
    })

    // new CloudWatch Logs group for the state machine
    const stateMachineLogsKey = new Key(this, "LogsEncryptionKey", {
      enableKeyRotation: true,
    });
    const stateMachineLogs = new LogGroup(this, "SfnLogs", {
      encryptionKey: stateMachineLogsKey,
    });

    const stateMachineDefintion = DefinitionBody.fromChainable(
      pdfToImageTask
      .next(prepBedrockInputTask)
      .next(callBedrockTask)
      .next(extractBedrockResult)
      .next(writeToS3)
      .next(publishEvent)
    )

    this.stateMachine = new StateMachine(this, "StateMachine", {
      logs: {
        destination: stateMachineLogs,
        level: LogLevel.ALL,
        includeExecutionData: true,
      },
      tracingEnabled: true,
      definitionBody: stateMachineDefintion
    });

    // add bedrock policy since it does not use L2 construct
    this.stateMachine.addToRolePolicy(
      new cdk.aws_iam.PolicyStatement({
        effect: cdk.aws_iam.Effect.ALLOW,
        actions: ['bedrock:InvokeModel'],
        resources: [bedrockModelArn]
      })
    )
    props.bucket.grantRead(this.stateMachine, 'wip/*')

    stateMachineLogsKey.grantEncryptDecrypt(
      new ServicePrincipal(
        ServicePrincipal.servicePrincipalName("logs.amazonaws.com")
      )
    );
    stateMachineLogsKey.grantEncrypt(this.stateMachine);
  }
}
