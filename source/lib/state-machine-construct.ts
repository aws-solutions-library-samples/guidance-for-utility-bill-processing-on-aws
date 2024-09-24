import * as cdk from "aws-cdk-lib";
import { Duration } from "aws-cdk-lib";
import { Effect, PolicyStatement, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Key } from "aws-cdk-lib/aws-kms";
import { Architecture, Runtime, Tracing } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { LogGroup } from "aws-cdk-lib/aws-logs";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { Queue } from "aws-cdk-lib/aws-sqs";
import {
  Choice,
  Condition,
  Fail,
  LogLevel,
  StateMachine,
  Succeed,
  TaskInput,
  Wait,
  WaitTime,
} from "aws-cdk-lib/aws-stepfunctions";
import * as tasks from "aws-cdk-lib/aws-stepfunctions-tasks";
import { Construct } from "constructs";
import path = require("path");

export interface StateMachineProps {
  dlq: Queue;
  bucket: Bucket;
}

// Normal use of Textract takes a few seconds (up to 30s) for
// asynchronous jobs. You can edit this value as you see fit,
// though anything over 30s should be superfluous.
const TEXTRACT_WAIT_DELAY_IN_S: cdk.Duration = Duration.seconds(15);

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

    const checkTextractJobStatusFunction = new NodejsFunction(
      this,
      "CheckTextractJobStatusFunction",
      {
        architecture: Architecture.ARM_64,
        entry: path.join(
          __dirname,
          "/../packages/checkTextractJobStatus/index.ts"
        ),
        memorySize: 512,
        runtime: Runtime.NODEJS_20_X,
        environmentEncryption: new Key(
          this,
          "CheckTextractJobStatusFunctionKey",
          {
            enableKeyRotation: true,
          }
        ),
        reservedConcurrentExecutions: 100,
        deadLetterQueue: props.dlq,
        tracing: Tracing.ACTIVE,
      }
    );

    checkTextractJobStatusFunction.addToRolePolicy(
      new PolicyStatement({
        actions: [
          "textract:GetDocumentAnalysis",
          "textract:GetExpenseAnalysis",
        ],
        resources: ["*"],
        effect: Effect.ALLOW,
      })
    );

    const invoicePostProcessingFunction = new NodejsFunction(
      this,
      "InvoicePostProcessingFunction",
      {
        architecture: Architecture.ARM_64,
        entry: path.join(
          __dirname,
          "/../packages/invoicePostProcessing/index.ts"
        ),
        memorySize: 1024,
        runtime: Runtime.NODEJS_20_X,
        environmentEncryption: new Key(
          this,
          "InvoicePostProcessingFunctionKey",
          {
            enableKeyRotation: true,
          }
        ),
        reservedConcurrentExecutions: 100,
        deadLetterQueue: props.dlq,
        tracing: Tracing.ACTIVE,
      }
    );

    invoicePostProcessingFunction.addToRolePolicy(
      new PolicyStatement({
        actions: [
          "textract:GetDocumentAnalysis",
          "textract:GetExpenseAnalysis",
        ],
        resources: ["*"],
        effect: Effect.ALLOW,
      })
    );

    const startQueriesFunction = new NodejsFunction(
      this,
      "StartQueriesFunction",
      {
        architecture: Architecture.ARM_64,
        entry: path.join(__dirname, "/../packages/startQueries/index.ts"),
        memorySize: 1024,
        runtime: Runtime.NODEJS_20_X,
        environmentEncryption: new Key(this, "StartQueriesFunctionKey", {
          enableKeyRotation: true,
        }),
        reservedConcurrentExecutions: 100,
        deadLetterQueue: props.dlq,
        tracing: Tracing.ACTIVE,
      }
    );

    startQueriesFunction.addToRolePolicy(
      new PolicyStatement({
        actions: ["textract:StartDocumentAnalysis"],
        resources: ["*"],
        effect: Effect.ALLOW,
      })
    );

    props.bucket.grantRead(startQueriesFunction);

    const waitForTextractDocumentAnalysisStep = new Wait(
      this,
      "WaitForTextractDocumentAnalysis",
      {
        time: WaitTime.duration(TEXTRACT_WAIT_DELAY_IN_S),
        comment:
          "Allows time for Textract to process the invoice asynchronously before attempting to check if ready",
      }
    );

    const waitForTextractExpenseAnalysisStep = new Wait(
      this,
      "WaitForTextractExpenseAnalysis",
      {
        time: WaitTime.duration(TEXTRACT_WAIT_DELAY_IN_S),
        comment:
          "Allows time for Textract to process the invoice asynchronously before attempting to check if ready",
      }
    );

    const postProcessingSteps = new tasks.LambdaInvoke(
      this,
      "postProcessingLambdaStep",
      {
        lambdaFunction: invoicePostProcessingFunction,
      }
    )
      .next(
        new tasks.CallAwsService(this, "PutObjectStep", {
          iamResources: [props.bucket.arnForObjects("*")],
          service: "s3",
          action: "putObject",
          parameters: {
            "Body.$": "$.Payload.invoiceOutput",
            Bucket: props.bucket.bucketName,
            "Key.$": "$.Payload.outputKey",
          },
        })
      )
      .next(new Succeed(this, "EndSuccessStep"));

    const documentAnalysisChoice = new Choice(
      this,
      "EvaluateGetDocumentAnalysisReadiness"
    )
      .when(
        Condition.or(
          Condition.stringEquals(
            "$.documentAnalysis.status.JobStatus",
            "SUCCEEDED"
          ),
          Condition.stringEquals(
            "$.documentAnalysis.status.JobStatus",
            "PARTIAL_SUCCESS"
          )
        ),
        postProcessingSteps
      )
      .when(
        Condition.stringEquals(
          "$.documentAnalysis.status.JobStatus",
          "IN_PROGRESS"
        ),
        waitForTextractDocumentAnalysisStep
      )
      .otherwise(new Fail(this, "FailedTextractQuery"));

    const getDocumentAnalysisBranch = new tasks.LambdaInvoke(
      this,
      "GetDocumentAnalysisStep",
      {
        lambdaFunction: checkTextractJobStatusFunction,
        payload: TaskInput.fromObject({
          "JobId.$": "$.queries.Payload.documentAnalysisJobId",
          API: "AnalyzeDocument",
        }),
        resultPath: "$.documentAnalysis.status",
        resultSelector: {
          "JobStatus.$": "$.JobStatus",
        },
        payloadResponseOnly: true,
      }
    ).next(documentAnalysisChoice);

    waitForTextractDocumentAnalysisStep.next(getDocumentAnalysisBranch);

    const startQueriesBranch = new tasks.LambdaInvoke(
      this,
      "startQueriesLambdaStep",
      {
        lambdaFunction: startQueriesFunction,
        resultPath: "$.queries",
        resultSelector: {
          "Payload.$": "$.Payload",
        },
      }
    ).next(
      new Choice(this, "StartQueriesChoiceStep", {
        comment:
          "Check if we need to wait for another Textract job to finish or proceed to post processing",
      })
        .when(
          Condition.booleanEquals("$.queries.Payload.waitForQuery", true),
          waitForTextractDocumentAnalysisStep
        )
        .otherwise(postProcessingSteps)
    );

    const getExpenseAnalysisStep = new tasks.LambdaInvoke(
      this,
      "GetExpenseAnalysis",
      {
        lambdaFunction: checkTextractJobStatusFunction,
        payload: TaskInput.fromObject({
          "JobId.$": "$.expenseAnalysis.id.JobId",
          API: "AnalyzeExpense",
        }),
        resultPath: "$.expenseAnalysis.status",
        resultSelector: {
          "JobStatus.$": "$.JobStatus",
        },
        payloadResponseOnly: true,
      }
    );

    waitForTextractExpenseAnalysisStep.next(getExpenseAnalysisStep);

    const evaluateGetExpenseAnalysisReadiness = new Choice(
      this,
      "EvaluateGetExpenseAnalysisReadiness"
    )
      .when(
        Condition.or(
          Condition.stringEquals(
            "$.expenseAnalysis.status.JobStatus",
            "SUCCEEDED"
          ),
          Condition.stringEquals(
            "$.expenseAnalysis.status.JobStatus",
            "PARTIAL_SUCCESS"
          )
        ),
        startQueriesBranch
      )
      .when(
        Condition.stringEquals(
          "$.expenseAnalysis.status.JobStatus",
          "IN_PROGRESS"
        ),
        waitForTextractExpenseAnalysisStep
      )
      .otherwise(new Fail(this, "FailedTextract"));

    getExpenseAnalysisStep.next(evaluateGetExpenseAnalysisReadiness);

    const preProcessingSteps = new tasks.CallAwsService(
      this,
      "StartExpenseAnalysis",
      {
        iamResources: ["*"],
        service: "textract",
        action: "startExpenseAnalysis",
        parameters: {
          DocumentLocation: {
            S3Object: {
              "Bucket.$": "$.detail.bucket.name",
              "Name.$": "$.detail.object.key",
            },
          },
        },
        resultPath: "$.expenseAnalysis.id",
      }
    ).next(waitForTextractExpenseAnalysisStep);

    // new CloudWatch Logs group for the state machine
    const stateMachineLogsKey = new Key(this, "LogsEncryptionKey", {
      enableKeyRotation: true,
    });
    const stateMachineLogs = new LogGroup(this, "SfnLogs", {
      encryptionKey: stateMachineLogsKey,
    });

    this.stateMachine = new StateMachine(this, "StateMachine", {
      logs: {
        destination: stateMachineLogs,
        level: LogLevel.ALL,
        includeExecutionData: true,
      },
      tracingEnabled: true,
      definition: preProcessingSteps,
    });

    stateMachineLogsKey.grantEncryptDecrypt(
      new ServicePrincipal(
        ServicePrincipal.servicePrincipalName("logs.amazonaws.com")
      )
    );
    stateMachineLogsKey.grantEncrypt(this.stateMachine);
  }
}
