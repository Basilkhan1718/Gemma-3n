from google import genai

API_KEY = "AIzaSyBWgfzMGk9HJEB1DqVj2a58JJu1HapsN-E"
MODEL_NAME = "gemma-3n-e2b-it"
client = genai.Client(api_key=API_KEY)
chat = client.chats.create(model=MODEL_NAME)

response = chat.send_message("I have 2 dogs in my house.")
print(response.text)

response = chat.send_message("How many paws are in my house?")
print(response.text)

for message in chat.get_history():
    print(f'role - {message.role}',end=": ")
    print(message.parts[0].text)