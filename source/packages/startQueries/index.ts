import {
  TextractClient,
  StartDocumentAnalysisCommand,
  StartDocumentAnalysisCommandInput,
  Query,
} from "@aws-sdk/client-textract";

type InputProps = {
  detail: {
    bucket: {
      name: string;
    };
    object: {
      key: string;
    };
  };
};

type ReturnProps = {
  waitForQuery: boolean;
  queriesUsed?: Query[];
  documentAnalysisJobId?: string;
};

/**
 * Used in Step Functions state machine to start a Textract StartDocumentAnalysis job
 * with the QUERIES job type. This is performed in Lambda code instead of an AWS service task
 * in Step Functions because it may need to reference a future datastore for more queries
 * to add into scope based on the utility provider, utility type, or utility account ID.
 * @param event
 * @returns
 */
export async function handler(event: InputProps): Promise<ReturnProps> {
  console.log("event 👉", event);

  const client = new TextractClient({
    region: process.env.AWS_REGION,
  });

  // build list of queries for Textract StartDocumentAnalysis
  const invoiceQueries: Query[] = [];

  /**
   * Sample query for illustrative purposes. Replace with
   * customized queries or a mechanism to lookup custom
   * queries based on the utility provider, utility type,
   * or utility account ID.
   * This sample query was tested against a 2023 invoice
   * from Xcel Energy on a home account.
   */
  invoiceQueries.push({
    Alias: "consumption_in_kwh",
    Text: "What is the kWh Usage of Total Energy in the METER READING INFORMATION table?",
    Pages: ["*"],
  });

  const params: StartDocumentAnalysisCommandInput = {
    DocumentLocation: {
      S3Object: {
        Bucket: event.detail.bucket.name,
        Name: event.detail.object.key,
      },
    },
    FeatureTypes: ["QUERIES"],
    QueriesConfig: {
      Queries: invoiceQueries,
    },
  };

  if (invoiceQueries.length > 0) {
    const response = await client.send(
      new StartDocumentAnalysisCommand(params)
    );

    if (response.JobId) {
      return {
        waitForQuery: true,
        queriesUsed: invoiceQueries,
        documentAnalysisJobId: response.JobId,
      };
    } else {
      throw new Error("Textract did not return a jobid");
    }
  } else {
    return {
      waitForQuery: false,
    };
  }
}
