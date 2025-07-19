# TODO: need to correct hugging face implementation
#   1. if it was manual it could be done by using cmd prompt with "huggingface-cli login" then entering the token(this is given by user in website) but we want automatic
#   2. then we can use the model downloaded on my device by AutoModelForCausalLM as usual 
from transformers import AutoModelForCausalLM, AutoProcessor
import torch
from flask import Flask, render_template, request, jsonify
import google.generativeai as genai

app = Flask(__name__)

# Global variables for API keys and models
GOOGLE_API_KEY = None
HF_API_KEY = None
gemma_model = None
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
    global GOOGLE_API_KEY, gemma_model
    GOOGLE_API_KEY = api_key
    genai.configure(api_key=GOOGLE_API_KEY)
    gemma_model = genai.GenerativeModel('gemma-3n-e2b-it')

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
    global gemma_model
    if not gemma_model:
        initialize_google_api(GOOGLE_API_KEY)

def split_into_chunks(texts, chunk_size=512):
    chunks=[]
    for text in texts:
        words=text.split()
        for i in range(0,len(words),chunk_size):
            chunk = " ".join(words[i:i+chunk_size])
            chunks.append(chunk)
    return chunks

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
    elif template_type == 'Code':
        message = message+"Give code."
    elif template_type == 'Graph':
        message = message+"Write this function in proper explicit mathematical form equation(like y=.....) if incorrectly written. And give the equation only."

    if use_context and embeddings_list:
        embedded_query=embedder.embed_query(message)
        scores=cosine_similarity([embedded_query],embeddings_list)[0]
        scores=cosine_similarity([embedded_query],embeddings_list)[0]
        top_index = sorted(list(enumerate(scores)), key=lambda x:x[1])[-1][0]
        query = all_chunks[top_index] + "\nGiven the above info as reference, answer the below question: " + message
    else:
        query=message

    try:
        if use_google_api:
            load_google_model()
            response = gemma_model.generate_content(query).text
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
            query="<image_soft_token>"+all_chunks[index]+"Given the above info as reference, answer the below question: "+message
        else:
            query="<image_soft_token>"+message
        
        from PIL import Image
        image = Image.open(image_file).convert("RGB")

        try:
            if use_google_api:
                load_google_model()
                response = gemma_model.generate_content([query, image]).text
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

if __name__ == '__main__':
    app.run(debug=True, use_reloader=False)