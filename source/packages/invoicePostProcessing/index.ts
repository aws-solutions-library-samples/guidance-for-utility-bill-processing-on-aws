import {
  Block,
  ExpenseDocument,
  GetDocumentAnalysisCommand,
  GetDocumentAnalysisCommandInput,
  GetDocumentAnalysisCommandOutput,
  GetExpenseAnalysisCommand,
  GetExpenseAnalysisCommandOutput,
  Query,
  TextractClient,
} from "@aws-sdk/client-textract";

// Sub-types to abstract some of the complexity of Step Functions input
type QueriesPayload = {
  Payload: {
    waitForQuery: boolean;
    queriesUsed?: Query[];
    documentAnalysisJobId?: string;
  };
};

type ExpenseAnalysis = {
  id: {
    JobId: string;
  };
};

type S3EventDetail = {
  bucket: {
    name: string;
  };
  object: {
    key: string;
  };
};

// Type to capture expected input parameters sent by Step Functions
type InputProps = {
  expenseAnalysis: ExpenseAnalysis;
  queries?: QueriesPayload;
  detail: S3EventDetail;
};

// The Lambda return type
type ReturnProps = {
  invoiceOutput: any;
  outputKey: string;
};

// Simple type to capture common details from any utility invoice.
// This could be extended per utility type (electric, gas, water, waste)
// or even per utility provider.
type UtilityInvoiceSummary = {
  UtilityName: string;
  AccountId: string;
  TotalCharges: string;
  DueDate: string;
  ConsumptionMetadata?: any;
};

/**
 * Extracts values from Textract ExpenseAnalysis. Uses the SummaryFields
 * from the first scanned page and finds the most confident result for
 * each of the required properties of UtilityInvoiceSummary
 * @param expense
 * @returns UtilityInvoiceSummary
 */
const extractValuesFromAnalyzeExpense = (
  expense: GetExpenseAnalysisCommandOutput
): UtilityInvoiceSummary => {
  if (!expense.ExpenseDocuments || expense.ExpenseDocuments.length === 0) {
    throw new Error("Textract expense had 0 documents in result");
  }

  // Assumes summary values are on page 1.
  // Could optimize by extracting summary fields from each document before sorting on confidence.
  // This is an area where additional utility-specific templating could be a value add to the solution.
  const doc = expense.ExpenseDocuments[0];

  if (!doc.SummaryFields) {
    throw new Error("Expense first page had no summary fields");
  }

  // List of supported Textract SummaryFields types isn't documented as
  // of this project. Below are the four SummaryFields types we use here.
  // ["VENDOR_NAME", "ACCOUNT_NUMBER", "DUE_DATE", "TOTAL"]

  /**
   * This function parses a single document from Textract results to find
   * the matches for a provided SummaryFields type and returns the text of
   * the result that has the highest confidence score.
   * Textract AnalyzeExpense can return in SummaryFields results more than
   * one item per type. This means that two or more results in SummaryFields
   * could have the type "VENDOR_NAME".
   * Note that confidence score is measuring the accuracy of the extracted
   * text, not the confidence that the given result is the best fit for
   * the indicated SummaryFields type.
   * @param doc
   * @param summaryFieldType
   * @returns
   */
  const getMostConfidentResultBySummaryFieldsType = (
    doc: ExpenseDocument,
    summaryFieldType: string
  ): string => {
    const vendorNameResultsSortedByConfidence = doc
      .SummaryFields!.filter((field) => field.Type?.Text === summaryFieldType)
      .sort(
        (a, b) =>
          (b.ValueDetection?.Confidence || 0) -
          (a.ValueDetection?.Confidence || 0)
      );
    return (
      vendorNameResultsSortedByConfidence[0].ValueDetection?.Text || "undefined"
    );
  };

  return {
    UtilityName: getMostConfidentResultBySummaryFieldsType(doc, "VENDOR_NAME"),
    AccountId: getMostConfidentResultBySummaryFieldsType(doc, "ACCOUNT_NUMBER"),
    TotalCharges: getMostConfidentResultBySummaryFieldsType(doc, "TOTAL"),
    DueDate: getMostConfidentResultBySummaryFieldsType(doc, "DUE_DATE"),
  };
};

const extractSummaryFieldsFromExpenseResult = async (
  client: TextractClient,
  jobId: string
): Promise<UtilityInvoiceSummary> => {
  const expenseResult = await client.send(
    new GetExpenseAnalysisCommand({
      JobId: jobId,
    })
  );

  if (!expenseResult.ExpenseDocuments) {
    throw new Error("Textract ExpenseAnalysis had invalid result");
  }

  return extractValuesFromAnalyzeExpense(expenseResult);
};

const extractQueryResultsFromAnalyzeDocumentResult = async (
  client: TextractClient,
  queries: Query[],
  jobId: string,
  summary: UtilityInvoiceSummary
): Promise<UtilityInvoiceSummary> => {
  const textractBlocks: Block[] = [];
  let pageToken: string | undefined = undefined;
  let queriesResult: GetDocumentAnalysisCommandOutput | undefined = undefined;

  do {
    let params: GetDocumentAnalysisCommandInput = {
      JobId: jobId,
    };
    if (pageToken) params.NextToken = pageToken;

    queriesResult = await client.send(new GetDocumentAnalysisCommand(params));

    if (!queriesResult.Blocks) {
      throw new Error("queriesResult had no Blocks defined");
    } else {
      textractBlocks.push(...queriesResult.Blocks);
    }

    // grab NextToken to iterate, otherwise set to undefined to break
    pageToken = queriesResult.NextToken ? queriesResult.NextToken : undefined;
  } while (pageToken);

  for (const query of queries) {
    let answerBlockId = null;

    for (const block of textractBlocks) {
      if (block.Query && block.Query.Alias === query.Alias) {
        // avoiding logging of entire Block to protect PII from entering logs
        console.log("matching block found", JSON.stringify(block.Id));
        if (
          block.Relationships &&
          block.Relationships.length > 0 &&
          block.Relationships[0].Ids &&
          block.Relationships[0].Ids[0]
        ) {
          answerBlockId = block.Relationships[0].Ids[0];
          break;
        } else {
          console.warn(
            "Found a matching query block, but block either had no relationship or relationship.ids defined"
          );
        }
      }
    }

    if (!answerBlockId) {
      console.warn(
        "Did not find any matching query block in results. Skipping to next query."
      );
      continue;
    }

    for (const block of textractBlocks) {
      if (block.BlockType === "QUERY_RESULT" && block.Id === answerBlockId) {
        // avoiding logging of entire Block to protect PII from entering logs
        console.log("answer block ID", JSON.stringify(block.Id));
        const metadata = {
          [query.Alias || "alias_undefined"]: block.Text,
        };
        summary.ConsumptionMetadata = {
          ...summary.ConsumptionMetadata,
          ...metadata,
        };
      }
    }
  }

  return summary;
};

export async function handler(event: InputProps): Promise<ReturnProps> {
  console.log("event 👉", event);

  // SDK client init
  const client = new TextractClient({
    region: process.env.AWS_REGION,
  });

  // Create the UtilityInvoiceSummary first from the SummaryFields of AnalyzeExpense
  let utilityInvoiceSummary: UtilityInvoiceSummary =
    await extractSummaryFieldsFromExpenseResult(
      client,
      event.expenseAnalysis.id.JobId
    );

  // If there were additional queries used by AnalyzeDocument, add those into our summary
  if (
    event.queries &&
    event.queries.Payload.queriesUsed &&
    event.queries.Payload.documentAnalysisJobId
  )
    utilityInvoiceSummary = await extractQueryResultsFromAnalyzeDocumentResult(
      client,
      event.queries?.Payload.queriesUsed,
      event.queries?.Payload.documentAnalysisJobId,
      utilityInvoiceSummary
    );

  return {
    invoiceOutput: utilityInvoiceSummary,
    outputKey: `output/${event.detail.object.key}.json`,
  };
}
