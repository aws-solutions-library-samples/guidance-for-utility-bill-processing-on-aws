import * as cdk from "aws-cdk-lib";
import { Duration, RemovalPolicy } from "aws-cdk-lib";
import { Rule, RuleTargetInput, EventField } from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
} from "aws-cdk-lib/aws-s3";
import { Queue, QueueEncryption } from "aws-cdk-lib/aws-sqs";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";
import { InvoiceStateMachine } from "./state-machine-construct";
import path = require("path");

export class InvoicesToInsightsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Note that all bucket contents are destroyed when the
    // stack is removed!
    // Note that invoices and any other objects uploaded
    // to the input/ and wip/ prefixes will be expired after 1 day.
    const bucket = new Bucket(this, "InvoicesBucket", {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      eventBridgeEnabled: true,
      serverAccessLogsPrefix: "accesslog/",
      lifecycleRules: [
        {
          expiration: Duration.days(1),
          prefix: "input/",
        },
        {
          expiration: Duration.days(1),
          prefix: "wip/",
        },
      ],
    });

    // This DLQ stores any failures throughout the project.
    // There are no included actors to process DLQ events.
    const dlq = new Queue(this, "InvoicesDLQ", {
      retentionPeriod: Duration.days(14),
      enforceSSL: true,
      encryption: QueueEncryption.KMS_MANAGED,
    });

    const invoiceStateMachine = new InvoiceStateMachine(
      this,
      "InvoiceStateMachine",
      {
        dlq: dlq,
        bucket: bucket,
      }
    );

    bucket.grantReadWrite(invoiceStateMachine.stateMachine);

    /**
     * This EventBridge Rule construct creates child resources on our behalf
     * with resource names starting with BucketNotificationsHandler.
     * There is a Lambda function and IAM role created.
     * CDK Nag and Checkov identify warnings for these resources.
     * CDK Nag suppressions are below, but Checkov suppressions cannot
     * be added here because the child constructs are not defined here in code.
     * Checkov warnings are CKV_AWS_111, CKV_AWS_117, CKV_AWS_115, CKV_AWS_116.
     */
    new Rule(this, "ebrule", {
      eventPattern: {
        source: ["aws.s3"],
        detail: {
          bucket: {
            name: [bucket.bucketName],
          },
          object: {
            key: [{ prefix: "input/" }],
          },
        },
        detailType: ["Object Created"],
      },
      targets: [
        new targets.SfnStateMachine(invoiceStateMachine.stateMachine, {
          retryAttempts: 1,
          maxEventAge: Duration.minutes(5),
          deadLetterQueue: dlq,
          input: RuleTargetInput.fromObject({
            bucket: EventField.fromPath('$.detail.bucket.name'),
            key: EventField.fromPath('$.detail.object.key')
          })
        }),
      ],
    });

    new cdk.CfnOutput(this, "bucketName", {
      value: bucket.bucketName,
      description: "Bucket to upload invoices",
      exportName: "invoiceBucket",
    });

    this.templateOptions.description = "Solution ID: SO9158";

    // cdk-nag suppressions
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      "/InvoicesToInsightsStack/BucketNotificationsHandler050a0587b7544547bf325f094a3db834/Role/Resource",
      [
        {
          id: "AwsSolutions-IAM4",
          reason:
            "Suppressing AWS managed policy warning because we dont have access to the bucket notifications handler under the hood",
        },
      ]
    );

    NagSuppressions.addResourceSuppressionsByPath(
      this,
      "/InvoicesToInsightsStack/BucketNotificationsHandler050a0587b7544547bf325f094a3db834/Role/DefaultPolicy/Resource",
      [
        {
          id: "AwsSolutions-IAM5",
          reason:
            "Suppressing AWS managed policy warning because we dont have access to the bucket notifications handler under the hood",
        },
      ]
    );

    NagSuppressions.addResourceSuppressionsByPath(
      this,
      "/InvoicesToInsightsStack/InvoiceStateMachine/PdfToImageFunction/ServiceRole/Resource",
      [
        {
          id: "AwsSolutions-IAM4",
          reason:
            "Suppressing AWS managed policy warning as the Basic Execution Role for Lambda has very limited permissions as is.",
        },
      ]
    );

    NagSuppressions.addResourceSuppressionsByPath(
      this,
      "/InvoicesToInsightsStack/InvoiceStateMachine/PdfToImageFunction/Resource",
      [
        {
          'id': 'AwsSolutions-L1',
          'reason': 'Suppress error as python 3_12 is the latest runtime available'
        },
      ]
    );

    NagSuppressions.addResourceSuppressionsByPath(
      this,
      "/InvoicesToInsightsStack/InvoiceStateMachine/PdfToImageFunction/ServiceRole/DefaultPolicy/Resource",
      [
        {
          id: "AwsSolutions-IAM5",
          reason:
            "Suppressing AWS managed policy warning as the Basic Execution Role for Lambda has very limited permissions as is.",
        },
      ]
    );

    NagSuppressions.addResourceSuppressionsByPath(
      this,
      "/InvoicesToInsightsStack/InvoiceStateMachine/BedrockInputFunction/ServiceRole/Resource",
      [
        {
          id: "AwsSolutions-IAM4",
          reason:
            "Suppressing AWS managed policy warning as the Basic Execution Role for Lambda has very limited permissions as is.",
        },
      ]
    );

    NagSuppressions.addResourceSuppressionsByPath(
      this,
      "/InvoicesToInsightsStack/InvoiceStateMachine/BedrockInputFunction/ServiceRole/DefaultPolicy/Resource",
      [
        {
          id: "AwsSolutions-IAM5",
          reason:
            "Suppressing AWS managed policy warning as the Basic Execution Role for Lambda has very limited permissions as is.",
        },
      ]
    );

    NagSuppressions.addResourceSuppressions(dlq, [
      {
        id: "AwsSolutions-SQS3",
        reason: "Resource is a DLQ, does not need a DLQ.",
      },
    ]);

    NagSuppressions.addResourceSuppressionsByPath(
      this,
      "/InvoicesToInsightsStack/InvoiceStateMachine/StateMachine/Role/DefaultPolicy/Resource",
      [
        {
          id: "AwsSolutions-IAM5",
          reason:
            "Suppressing policy resource wildcard warning because this state machine needs full access to the S3 bucket",
        },
      ]
    );
  }
}
