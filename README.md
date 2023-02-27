## Guidance for Utility Bill Processing on AWS

The sample code in this project deploys a customizable pipeline on AWS for converting utility bill invoices in a PDF format into a structured data schema for use in downstream analytics.

This workload can be used to extract billing and consumption insights from your conventional utility bills, then aggregate these insights to identify cost or sustainability KPIs such as buildings contributing the greatest emissions footprint within your portfolio.

### Architecture

The following diagram depicts the architecture of the CDK stack deployed by this project:

![CDK architecture](/assets/CDK-architecture.png)

The following diagram depicts the state machine in AWS Step Functions deployed by this project:

![SFN architecture](/assets/SFN-architecture.png)

### Project folder structure

- assets - graphics used in this README, sample invoice for testing
- deployment - empty, CDK synthesizes stack here for deployment
- source
  - bin - stores TypeScript app invoked by CDK
  - lib - stores stack and construct definitions in TypeScript
  - packages - Lambda sources used in this stack

## Getting started

### Prerequisites

You will need Node.js, Node Package Manager (npm), and AWS Cloud Development Kit installed on your local machine to build and deploy this project.

- [Installing Node.js](https://nodejs.org/en/download/)
- [Installing AWS CDK](https://docs.aws.amazon.com/cdk/v2/guide/getting_started.html)

You will then need to [bootstrap](https://docs.aws.amazon.com/cdk/v2/guide/getting_started.html#getting_started_bootstrap) your AWS account using the CDK:

`cdk bootstrap aws://ACCOUNT-NUMBER/REGION`

### Deploying the CDK stack

From the `source` directory, run the following commands:

`npm install`
`cdk synth`
`cdk deploy`

Once the deployment succeeds (you will need to accept the confirmation prompts on first deploy), the sample is ready for your use.

## Using the sample

To process an invoice through this sample, you will need to upload a PDF invoice to the deployed S3 bucket with an object prefix of `input/`. You can do this from the AWS Management Console for S3, programmatically with the AWS SDK, or using the AWS CLI.

You can get the name of the deployed bucket from the CloudFormation output called "invoiceBucket" that appears after running `cdk deploy`. You can also find it in the CloudFormation management console, or looking in your list of S3 buckets for the one prefixed "invoicestoinsightsstack-invoicesbucket".

If you have the [AWS CLI installed](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html), run this command from the parent directory of this project to put an invoice named `sample-invoice.pdf` in the bucket (provided in the `assets/` folder), triggering the processing workflow:

`aws s3 cp assets/sample-invoice.pdf s3://YOUR-BUCKET-NAME/input/sample-invoice.pdf`

After about 30 seconds, the normalized output can be found in the same S3 bucket at the path `s3://YOUR-BUCKET-NAME/output/my-invoice.pdf.json`. You can always find the results of processing by changing the invoice filename prefix to `output/` from `input/`.

### Customizing pre-processing

In the pre-processing step of the state machine, identified by the Lambda function at `source/packages/startQueries`, you will find a sample query that was derived from testing with a 2023 Xcel Energy utility bill from the author's personal account.

Each query added to the `invoiceQueries` array will instruct Amazon Textract to process the document looking for an answer to the query. In testing with a 2023 Xcel Energy utility bill, the prompt "What is the kWh Usage of Total Energy in the METER READING INFORMATION table?" was found to be consistent in returning the consumption in kilowatt-hours.

To "onboard" a utility provider to this solution, you will need to experiment with the queries functionality to extract and output the relevant values for your data output model. Standard details like the utility name, total charges, and due date are handled for you by the included post-processor.

If a query has no matching result in the result set, it will be skipped when writing output in post-processing.

### Customizing post-processing

In the post-processing step of the state machine, identified by the Lambda function at `source/packages/invoicePostProcessing`, you will find methods for extracting common values from the Amazon Textract AnalyzeExpense API and the specific queries defined in pre-processing.

You can also find the data schema used to write output back to the S3 bucket. This data schema can be modified to suit your downstream consumption needs, or an AWS Glue job could be configured for downstream ETL based on the included schema.

## Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information.

## Cleanup

Note that tearing down the stack will destroy ALL contents of the S3 bucket!

To remove the sample stack from your AWS account, you can run the `cdk destroy` command from within the `source/` directory, or terminate the stack in the AWS management console from Amazon CloudFormation.

## License

This library is licensed under the MIT-0 License. See the LICENSE file.
