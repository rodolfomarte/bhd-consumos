import os
from typing import Generator
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from dotenv import load_dotenv

load_dotenv()

SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]
CREDENTIALS_FILE = os.getenv("GOOGLE_CREDENTIALS_FILE", "credentials.json")
TOKEN_FILE = os.getenv("GOOGLE_TOKEN_FILE", "token.json")
GMAIL_QUERY = os.getenv(
    "GMAIL_QUERY",
    'from:Alertas@bhd.com.do subject:"BHD Notificación de Transacciones"',
)
MAX_RESULTS = int(os.getenv("GMAIL_MAX_RESULTS", "100"))


def _autenticar():
    """Devuelve credenciales OAuth2, renovando o creando token según sea necesario."""
    creds = None
    if os.path.exists(TOKEN_FILE):
        creds = Credentials.from_authorized_user_file(TOKEN_FILE, SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not os.path.exists(CREDENTIALS_FILE):
                raise FileNotFoundError(
                    f"No se encontró '{CREDENTIALS_FILE}'. "
                    "Descárgalo desde Google Cloud Console y colócalo en la raíz del proyecto."
                )
            flow = InstalledAppFlow.from_client_secrets_file(CREDENTIALS_FILE, SCOPES)
            creds = flow.run_local_server(port=0)
        with open(TOKEN_FILE, "w") as f:
            f.write(creds.to_json())
    return creds


def obtener_emails_bhd() -> Generator[dict, None, None]:
    """
    Genera dicts con {email_id, subject, payload} de cada correo BHD encontrado.
    Usa paginación para recorrer todos los mensajes que coincidan con GMAIL_QUERY.
    """
    creds = _autenticar()
    service = build("gmail", "v1", credentials=creds)
    messages_resource = service.users().messages()

    fetched = 0
    page_token = None

    while True:
        params = {
            "userId": "me",
            "q": GMAIL_QUERY,
            "maxResults": min(MAX_RESULTS - fetched, 100),
        }
        if page_token:
            params["pageToken"] = page_token

        response = messages_resource.list(**params).execute()
        messages = response.get("messages", [])

        for msg_ref in messages:
            if fetched >= MAX_RESULTS:
                return
            msg = messages_resource.get(
                userId="me", id=msg_ref["id"], format="full"
            ).execute()

            headers = {
                h["name"]: h["value"]
                for h in msg.get("payload", {}).get("headers", [])
            }
            yield {
                "email_id": msg_ref["id"],
                "subject": headers.get("Subject", ""),
                "payload": msg.get("payload", {}),
            }
            fetched += 1

        page_token = response.get("nextPageToken")
        if not page_token or fetched >= MAX_RESULTS:
            break
