import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    DB_HOST     = os.getenv("DB_HOST",     "localhost")
    DB_PORT     = os.getenv("DB_PORT",     "5432")
    DB_NAME     = os.getenv("DB_NAME",     "lgu_masterdata")
    DB_USER     = os.getenv("DB_USER",     "postgres")
    DB_PASSWORD = os.getenv("DB_PASSWORD", "")  # set in backend/.env (never commit it)

    # Sir Shem's suggestion: a constrained Gemini-API explainer feature
    # (see backend/gemini_explainer.py). Not required for the app to run --
    # every route that uses it fails soft with a clear message when this
    # is blank. Set in backend/.env as GEMINI_API_KEY=... (get a free key
    # from https://aistudio.google.com/apikey). Never commit the real key.
    GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

    @staticmethod
    def get_connection_string():
        return (
            f"host={Config.DB_HOST} "
            f"port={Config.DB_PORT} "
            f"dbname={Config.DB_NAME} "
            f"user={Config.DB_USER} "
            f"password={Config.DB_PASSWORD}"
        )