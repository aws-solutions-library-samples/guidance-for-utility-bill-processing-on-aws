import pymupdf
import boto3
import uuid

s3 = boto3.client('s3')

def handler(event, context):
  bucket = event['bucket']
  key = event['key']

  # get the object from s3
  s3_response = s3.get_object(Bucket=bucket, Key=key)
  doc = pymupdf.Document(stream=s3_response['Body'].read())

  prefix = f"wip/{str(uuid.uuid4())}"
  print("foo")
  image_outputs = []

  for page in doc:
    # log page number to test
    dpi = 300
    max_pixel_allowed = 1568
    print(f"Page number: {page.number}")

    pic = page.get_pixmap(dpi=dpi)

    # resize if necessary, 
    # Anthropic will resize every image to max 1568 pixels per side. 
    # To avoid an image exceeding the 5MB size limit, we will resize already here
    print("resizing if necessary")
    max_pixel_image = max(pic.height, pic.width)
    if max_pixel_image > max_pixel_allowed:
        ratio = max_pixel_allowed / max_pixel_image
        dpi = int(dpi * ratio)
        pic = page.get_pixmap(dpi=dpi)

    tmp_file_path = f"/tmp/{page.number}.png"
    pic.save(tmp_file_path)

    # log tmp file name to test
    print("file saved to tmp")

    # upload the file to s3
    key = f"{prefix}/image_{page.number}.png"
    s3.upload_file(
      tmp_file_path,
      bucket,
      key
    )

    # append s3 location to image_outputs array
    image_outputs.append({
      'Bucket': bucket,
      'Key': key
    })
    print(f"file uploaded to s3 {key}")

  return image_outputs