from transformers import AutoModelForCausalLM, AutoProcessor
import torch
import base64
from io import BytesIO
from PIL import Image
from flask import Flask, render_template, request, jsonify
from google import genai
from google.genai import types

app = Flask(__name__)

# Global variables for API keys and models
GOOGLE_API_KEY = None
HF_API_KEY = None

# for api 
GEMMA_MODEL_NAME = "models/gemma-3n-e4b-it"
gemma_model_chat = None
google_client = None
# Hugging Face model and processor
hf_model = None
hf_processor = None

use_google_api = True

@app.route('/set_api_keys', methods=['POST'])
def set_api_keys():
    data = request.json
    if 'google_api_key' in data:
        initialize_google_api(data['google_api_key'])
        return jsonify({'message': 'Google API key set successfully'})
    elif 'hf_api_key' in data:
        initialize_huggingface_model(data['hf_api_key'])
        return jsonify({'message': 'Hugging Face API key set successfully'})
    else:
        return jsonify({'error': 'No API key provided'}), 400

@app.route('/set_model_preferences', methods=['POST'])
def set_model_preferences():
    global use_google_api
    data = request.json
    use_google_api = data.get('use_google_api', True)
    return jsonify({'message': 'Model preferences updated successfully'})

def initialize_google_api(api_key):
    global GOOGLE_API_KEY, gemma_model_chat, google_client 
    GOOGLE_API_KEY = api_key
    
    google_client = genai.Client(api_key=GOOGLE_API_KEY)
    gemma_model_chat = google_client.chats.create(model=GEMMA_MODEL_NAME)

def initialize_huggingface_model(api_key):
    global HF_API_KEY, hf_model, hf_processor
    HF_API_KEY = api_key
    model_name = "google/gemma-3n-e2b-it"
    model = AutoModelForCausalLM.from_pretrained(model_name, token=HF_API_KEY)
    processor = AutoProcessor.from_pretrained(model_name, token=HF_API_KEY)
    # device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    device = torch.device('cpu')  # Force CPU for compatibility
    hf_model = model.to(device)
    hf_processor = processor

import fitz
import io

def load_pdf(file_obj):
    doc = fitz.open(stream=file_obj, filetype="pdf")
    texts=[]
    for page in doc:
        texts+=[page.get_text()]
    return texts

def load_huggingface_model():
    global hf_model, hf_processor
    if not hf_model or not hf_processor:
        initialize_huggingface_model(HF_API_KEY)

def load_google_model():
    global gemma_model_chat
    if not gemma_model_chat:
        initialize_google_api(GOOGLE_API_KEY)

def split_into_chunks(texts, chunk_size=512):
    chunks=[]
    for text in texts:
        words=text.split()
        for i in range(0,len(words),chunk_size):
            chunk = " ".join(words[i:i+chunk_size])
            chunks.append(chunk)
    return chunks

def pil_image_to_base64(image: Image.Image, format="jpeg") -> str:
    """Converts a PIL Image object to a base64 string."""
    buffered = BytesIO()
    image.save(buffered, format=format)
    return base64.b64encode(buffered.getvalue()).decode("utf-8")

from langchain_huggingface import HuggingFaceEmbeddings
from sklearn.metrics.pairwise import cosine_similarity

embeddings_list=[]
all_chunks=[]

embedder = HuggingFaceEmbeddings(model_name='sentence-transformers/all-MiniLM-L6-v2')

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/chat', methods=['POST'])
def chat():
    global embeddings_list, all_chunks, use_google_api
    data = request.json
    message = data.get('message', '')
    use_context = data.get('use_context', True)
    template_type = data.get('template_type', 'none')

    if template_type == 'Bulletpoints Summarization':
        message = message+"Give the output in points."
    elif template_type == 'Summary':
        message = message+"Give the output as a summary of the query."

    if use_context and embeddings_list:
        embedded_query=embedder.embed_query(message)
        scores=cosine_similarity([embedded_query],embeddings_list)[0]

        top_index = sorted(list(enumerate(scores)), key=lambda x:x[1])[-1][0]
        query = all_chunks[top_index] + "\nGiven the above info as reference, answer the below question: " + message
    else:
        query=message

    try:
        if use_google_api:
            load_google_model()
            response = gemma_model_chat.send_message(query).text
        else:
            load_huggingface_model()
            inputs = hf_processor(text=query, return_tensors="pt")
            inputs = {k: v.to(hf_model.device) for k, v in inputs.items()}
            outputs = hf_model.generate(**inputs, max_new_tokens=150)
            response = hf_processor.batch_decode(outputs, skip_special_tokens=True)[0]
    except Exception as e:
        response = f"Error generating response: {str(e)}"

    return jsonify({'reply': response})

@app.route('/upload_pdf', methods=['POST'])
def upload_pdf():
    global embeddings_list, all_chunks
    file = request.files['pdf']
    pdf_bytes = file.read()
    pdf_stream = io.BytesIO(pdf_bytes)
    pdf_texts = load_pdf(pdf_stream)
    all_chunks=split_into_chunks(pdf_texts)
    embeddings_list = embedder.embed_documents(all_chunks)
    return jsonify({'result': 'PDF uploaded and processed successfully'})

@app.route('/image_prompt_chat', methods=['POST'])
def image_prompt_chat():
    global embeddings_list, all_chunks, use_google_api
    try:
        image_file = request.files['image']
        message = request.form['prompt']
        use_context = request.form.get('use_context', 'false').lower() == 'true'

        if use_context and embeddings_list:
            embedded_query=embedder.embed_query(message)
            scores=cosine_similarity([embedded_query],embeddings_list)[0]
            top_match = sorted(list(enumerate(scores)), key=lambda x:x[1])[-1]
            query="<image_soft_token>"+all_chunks[top_match[0]]+"Given the above info as reference, answer the below question: "+message
        else:
            query="<image_soft_token>"+message
        
        from PIL import Image
        image = Image.open(image_file).convert("RGB")

        try:
            if use_google_api:
                # with google-genai SDK you can just pass the PIL Image directly
                load_google_model()
                image = image.resize((512, 512))

                # 2. Save into a BytesIO buffer (seekable and binary)
                image_bytes = BytesIO()
                image.save(image_bytes, format='JPEG')
                image_bytes.seek(0)  # Make sure it's seekable before uploading

                # 3. Upload — note: the SDK expects `content_type`, not `mime_type`
                img_uploaded = google_client.files.upload(
                    file=image_bytes,           # raw bytes
                    config=types.UploadFileConfig(
                        mime_type="image/jpeg"  # or "image/png"
                    )
                )
                # send text+image in one call 
                response_obj = google_client.models.generate_content(
                    model="gemini-2.5-flash",
                    contents=[img_uploaded, message]
                )
                response = response_obj.text
                google_client.files.delete(name=img_uploaded.name)
            else:
                load_huggingface_model()
                inputs = hf_processor(images=image, text=query, return_tensors="pt").to(hf_model.device)
                outputs = hf_model.generate(**inputs, max_new_tokens=150)
                response = hf_processor.batch_decode(outputs, skip_special_tokens=True)[0]
        except Exception as e:
            response = f"Error generating response: {str(e)}"

        return jsonify({'reply': response})
    except Exception as e:
        return jsonify({'reply': f'Error: {str(e)}'}), 500

    except Exception as e:
        return jsonify({'reply': f'Error: {str(e)}'}), 500

if __name__ == '__main__':
    app.run(debug=True, use_reloader=False)
