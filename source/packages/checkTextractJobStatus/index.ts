import {
  GetDocumentAnalysisCommand,
  GetExpenseAnalysisCommand,
  TextractClient,
} from "@aws-sdk/client-textract";

type InputProps = {
  JobId: string;
  API: string;
};

type ReturnProps = {
  JobStatus: string;
};

/**
 * Used in Step Functions state machine to get the status of
 * a Textract job. Textract responses are too large for the
 * limits of Step Functions.
 * @param event
 * @returns
 */
export async function handler(event: InputProps): Promise<ReturnProps> {
  console.log("event 👉", event);

  const client = new TextractClient({
    region: process.env.AWS_REGION,
  });

  const params = {
    JobId: event.JobId,
  };

  const textractCommand:
    | GetExpenseAnalysisCommand
    | GetDocumentAnalysisCommand =
    event.API === "AnalyzeExpense"
      ? new GetExpenseAnalysisCommand(params)
      : new GetDocumentAnalysisCommand(params);

  const response = await client.send(textractCommand);

  return {
    JobStatus: response.JobStatus || "FAILED",
  };
}
