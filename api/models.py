from datetime import datetime
from typing import List

from pydantic import BaseModel


class Message(BaseModel):
    text: str
    sender: str
    timestamp: int = None
