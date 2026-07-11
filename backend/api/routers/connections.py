"""Friend connections: request, accept, list, remove."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import or_, select

from api.deps import CurrentUser, SessionDep
from api.schemas import ConnectionCreate, ConnectionOut, ConnectionUpdate
from core.models import Connection, ConnectionStatus

router = APIRouter(prefix="/connections", tags=["connections"])


async def _find_between(
    session: SessionDep, a: uuid.UUID, b: uuid.UUID
) -> Connection | None:
    stmt = select(Connection).where(
        or_(
            (Connection.first_id == a) & (Connection.second_id == b),
            (Connection.first_id == b) & (Connection.second_id == a),
        )
    )
    connection: Connection | None = await session.scalar(stmt)
    return connection


@router.get("", response_model=list[ConnectionOut])
async def list_connections(
    session: SessionDep, user: CurrentUser
) -> list[Connection]:
    stmt = select(Connection).where(
        or_(Connection.first_id == user.id, Connection.second_id == user.id)
    )
    return list((await session.scalars(stmt)).all())


@router.post("", response_model=ConnectionOut, status_code=status.HTTP_201_CREATED)
async def create_connection(
    payload: ConnectionCreate, session: SessionDep, user: CurrentUser
) -> Connection:
    if payload.target_user_id == user.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "cannot connect to yourself")

    existing = await _find_between(session, user.id, payload.target_user_id)
    if existing is not None:
        # If the other party requested first, treat this as acceptance.
        if (
            existing.status == ConnectionStatus.pending
            and existing.second_id == user.id
        ):
            existing.status = ConnectionStatus.accepted
            await session.flush()
            await session.refresh(existing)
        return existing

    connection = Connection(
        first_id=user.id,
        second_id=payload.target_user_id,
        status=ConnectionStatus.pending,
    )
    session.add(connection)
    await session.flush()
    await session.refresh(connection)
    return connection


@router.put("/{target_user_id}", response_model=ConnectionOut)
async def update_connection(
    target_user_id: uuid.UUID,
    payload: ConnectionUpdate,
    session: SessionDep,
    user: CurrentUser,
) -> Connection:
    connection = await _find_between(session, user.id, target_user_id)
    if connection is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "connection not found")
    connection.status = payload.status
    await session.flush()
    await session.refresh(connection)
    return connection


@router.delete("/{target_user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_connection(
    target_user_id: uuid.UUID, session: SessionDep, user: CurrentUser
) -> None:
    connection = await _find_between(session, user.id, target_user_id)
    if connection is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "connection not found")
    await session.delete(connection)
