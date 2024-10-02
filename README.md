## Guidance for Utility Bill Processing on AWS

The sample code in this project deploys a customizable pipeline on AWS for converting utility bill invoices in a PDF format into a structured data schema for use in downstream analytics.

This workload can be used to extract billing and consumption insights from your conventional utility bills, then aggregate these insights to identify cost or sustainability KPIs such as buildings contributing the greatest emissions footprint within your portfolio.

### Architecture

The following diagram depicts the architecture of the CDK stack deployed by this project:

![CDK architecture](/assets/CDK-architecture.png)

The following diagram depicts the state machine in AWS Step Functions deployed by this project:

![SFN architecture](/assets/SFN-architecture.png)

### Cost

You are responsible for the cost of the AWS services used while running this Guidance. As of 29th August 2024, the cost for running this Guidance with the default settings in the Default AWS Region US East-1 (N. Virginia) is approximately $75.28 USD per month for processing 5000 utility bills per month in the solution.

We recommend creating a Budget through AWS Cost Explorer to help manage costs. Prices are subject to change. For full details, refer to the pricing webpage for each AWS service used in this Guidance.

### Sample Cost Table

The following table provides a sample cost breakdown for deploying this Guidance with the default parameters in the US East (N. Virginia) Region for one month.

| AWS service  | Dimensions | Cost [USD] |
| ----------- | ------------ | ------------ |
| Amazon Bedrock | 16,000,000 Input Tokens and 1,500,000 Output tokens using Anthropic Claude 3 Sonnet | $70.50 |
| AWS Step Functions | 40,000 transitions using Standard workflows  | $1.00 |
| AWS Lambda |  10,000 invocations and 23781  GB-seconds | < $1.00 |
| Amazon S3 | S3 Standard storage (27 GB per month) | < $1.00 |
| others | Amazon CloudWatch Logs, Amazon EventBridge  | < $1.00 |

### Project folder structure

- assets - graphics used in this README, sample invoice for testing
- deployment - empty, CDK synthesizes stack here for deployment
- source
  - bin - stores TypeScript app invoked by CDK
  - lib - stores stack and construct definitions in TypeScript
  - packages - Lambda sources used in this stack

## Getting started

### Prerequisites

You will need Docker, Node.js, Node Package Manager (npm), and AWS Cloud Development Kit installed on your local machine to build and deploy this project.
Also, make sure that the Docker daemon is running when you are deploying this solution.

- [Installing Docker](https://docs.docker.com/engine/install/)
- [Start the Docker daemon](https://docs.docker.com/engine/daemon/start/)
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

After about 30 seconds, the normalized output can be found in the same S3 bucket at the path `s3://YOUR-BUCKET-NAME/output/my-invoice.pdf.json`. You can always find the results of processing by changing the invoice filename prefix to `output/` from `input/`.  You will also note a prefix `wip/` which is used for temporary data to pass between states of the state machine.

Please be aware that the uploaded invoices and all temporary data are set to expire after one day.  If you require this data longer, please update the S3 Bucket lifecycle policy to avoid data loss.

### Customizing the prompt

A sample prompt has been provided, which will be passed to Amazon Bedrock using the Anthropic Claude 3 Sonnet model.  You will want to experiment with different prompts and customize for your use case.  There are 2 ways to customize the prompt.

1. To permapermanently change the prompt, edit the `prompt.txt` file and redeploy this solution.

2. For experimentation, you can manually start an execution of the `InvoiceToInsights` state machine.  It takes payload following the schema below, with an optional `prompt` parameter, which will be used instead of the default prompt.  All other executions will use the default prompt.

```json
{
  "Bucket": "<S3 Bucket deployed by the soluiton>",
  "Key": "input/<your-filename.pdf>",
  "prompt": "the prompt to use for this particular execution".
}
```

You can also customize the Foundational Model used by Amazon Bedrock by modifying the `MODEL_ID` variable in [source/lib/state-machine-construct.ts](/source/lib/state-machine-construct.ts)



## Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information.

## Cleanup

Note that tearing down the stack will destroy ALL contents of the S3 bucket!

To remove the sample stack from your AWS account, you can run the `cdk destroy` command from within the `source/` directory, or terminate the stack in the AWS management console from Amazon CloudFormation.

## License

This library is licensed under the MIT-0 License. See the LICENSE file.

This package requires and may incorporate or retrieve a number of third-party
software packages (such as open source packages) at install-time or build-time
or run-time ("External Dependencies"). The External Dependencies are subject to
license terms that you must accept in order to use this package. If you do not
accept all of the applicable license terms, you should not use this package. We
recommend that you consult your company’s open source approval policy before
proceeding.

Provided below is a list of External Dependencies and the applicable license
identification as indicated by the documentation associated with the External
Dependencies as of Amazon's most recent review.

THIS INFORMATION IS PROVIDED FOR CONVENIENCE ONLY. AMAZON DOES NOT PROMISE THAT
THE LIST OR THE APPLICABLE TERMS AND CONDITIONS ARE COMPLETE, ACCURATE, OR
UP-TO-DATE, AND AMAZON WILL HAVE NO LIABILITY FOR ANY INACCURACIES. YOU SHOULD
CONSULT THE DOWNLOAD SITES FOR THE EXTERNAL DEPENDENCIES FOR THE MOST COMPLETE
AND UP-TO-DATE LICENSING INFORMATION.

YOUR USE OF THE EXTERNAL DEPENDENCIES IS AT YOUR SOLE RISK. IN NO EVENT WILL
AMAZON BE LIABLE FOR ANY DAMAGES, INCLUDING WITHOUT LIMITATION ANY DIRECT,
INDIRECT, CONSEQUENTIAL, SPECIAL, INCIDENTAL, OR PUNITIVE DAMAGES (INCLUDING
FOR ANY LOSS OF GOODWILL, BUSINESS INTERRUPTION, LOST PROFITS OR DATA, OR
COMPUTER FAILURE OR MALFUNCTION) ARISING FROM OR RELATING TO THE EXTERNAL
DEPENDENCIES, HOWEVER CAUSED AND REGARDLESS OF THE THEORY OF LIABILITY, EVEN
IF AMAZON HAS BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES. THESE LIMITATIONS
AND DISCLAIMERS APPLY EXCEPT TO THE EXTENT PROHIBITED BY APPLICABLE LAW.

PyMuPDF (AGPL-3.0) - https://github.com/pymupdf/PyMuPDF
