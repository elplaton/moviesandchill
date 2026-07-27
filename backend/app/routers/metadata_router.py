from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.auth.dependencies import get_current_user

router = APIRouter(prefix="/api", tags=["metadata"])


class MetadataRequest(BaseModel):
    names: list[str]


@router.post("/metadata/batch")
async def batch_metadata(req: MetadataRequest, user: Annotated[str, Depends(get_current_user)]):
    from app.routers.download import config
    api_key = config.get("tmdb_api_key", "")
    if not api_key:
        return {"metadata": {}}
    from app.services.tmdb import batch_search, clean_title
    cleaned = [clean_title(n) for n in req.names if n]
    results = await batch_search(api_key, cleaned)
    return {"metadata": {name: meta for name, meta in results.items()}}
