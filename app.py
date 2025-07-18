from transformers import AutoModelForCausalLM, AutoProcessor
import torch
from flask import Flask, render_template, request, jsonify

app = Flask(__name__)

import fitz
import io

def load_pdf(file_obj):
    doc = fitz.open(stream=file_obj, filetype="pdf")
    texts=[]
    for page in doc:
        texts+=[page.get_text()]
    return texts

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
    global embeddings_list
    global all_chunks
    data = request.json
    message = data.get('message', '')
    use_context = data.get('use_context', True)

    if use_context==True and embeddings_list:
        embedded_query=embedder.embed_query(message)
        scores=cosine_similarity([embedded_query],embeddings_list)[0]
        index, score= sorted(list(enumerate(scores)), key=lambda x:x[1])[-1]
        print(all_chunks[index])
        query=all_chunks[index]+"Given the above info as reference, answer the below question: "+message
    else:
        query=message
    inputs = processor(text=query, return_tensors="pt")
    inputs = {k: v.to(device) for k, v in inputs.items()}

    outputs = model.generate(**inputs, max_new_tokens=150)
    response = processor.batch_decode(outputs, skip_special_tokens=True)[0]
    return jsonify({'reply': response})

@app.route('/upload_pdf', methods=['POST'])
def upload_pdf():
    global embeddings_list
    global all_chunks
    file = request.files['pdf']
    print("Received PDF:", file.filename)
    
    pdf_bytes = file.read()
    pdf_stream = io.BytesIO(pdf_bytes)
    pdf_texts = load_pdf(pdf_stream)
    all_chunks=split_into_chunks(pdf_texts)
    embeddings_list = embedder.embed_documents(all_chunks)
    return jsonify({'result': 'PDF uploaded and processed successfully'})

if __name__ == '__main__':
    model_name = "google/gemma-3n-E2B-it"
    model = AutoModelForCausalLM.from_pretrained(model_name)
    processor = AutoProcessor.from_pretrained(model_name)

    # device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    device = 'cpu'  # Force CPU for compatibility
    model = model.to(device)

    app.run(debug=True, use_reloader=False)
