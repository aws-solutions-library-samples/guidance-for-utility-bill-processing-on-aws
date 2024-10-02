import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { randomUUID } from "crypto"
const s3Client = new S3Client({})
const wipBucketName = process.env.BUCKET_NAME
const defaultPromptText = process.env.DEFAULT_PROMPT_TEXT || ''

// create an interface for the S3 location of the image
interface S3Location {
  Bucket: string
  Key: string
}

const getImageFromS3 = async (Bucket: string, Key: string) => {
  const response = await s3Client.send(new GetObjectCommand({
    Bucket,
    Key
  }))
  return response.Body?.transformToString('base64') || ''
}

// create a function writeToS3 which takes the provided JSON string and writes it to S3
const writeToS3 = async (input: any) => {
  const Bucket = wipBucketName
  const Key = `wip/${randomUUID()}.json`
  const response = await s3Client.send(new PutObjectCommand({
    Bucket,
    Key,
    Body: JSON.stringify(input),
  }))
  return { Bucket, Key }
}

const addImagesToPrompt = async (content: any[], imageLocations: S3Location[]) => {
  
  const rawImages = await Promise.all(imageLocations.map(async ({ Bucket, Key }) => {
    return await getImageFromS3(Bucket, Key)
  }))

  // iterate through images and append to content
  rawImages.forEach((rawImage) => {
    content.push({
      "type": "image",
      "source": {
          "type": "base64",
          "media_type": "image/png",
          "data": rawImage
      },
    })
  })

  return content
}

export const handler = async (event: { images: S3Location[], prompt?: string }): Promise<any> => {

  const promptContent: any[] = [{"type": "text", "text": event.prompt || defaultPromptText }]

  const content = await addImagesToPrompt(promptContent, event.images)
 
  const input = {
    "anthropic_version": "bedrock-2023-05-31",
    "max_tokens": 4096,
    "messages": [
        {
          "role": "user",
          content
        }
    ],
  }

  const { Bucket, Key } = await writeToS3(input)
  return { Bucket, Key }
}