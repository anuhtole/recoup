"""company vendors and contracts

Revision ID: b41c7e2d9a10
Revises: 87e5c8fd4268
Create Date: 2026-11-05 15:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from recoup.db.models import UtcDateTime

# revision identifiers, used by Alembic.
revision: str = "b41c7e2d9a10"
down_revision: str | Sequence[str] | None = "87e5c8fd4268"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "vendors",
        sa.Column("key", sa.String(length=255), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("support_email", sa.String(length=255), nullable=False),
        sa.Column("domains", sa.JSON(), nullable=False),
        sa.Column("aliases", sa.JSON(), nullable=False),
        sa.Column("origin", sa.String(length=16), nullable=False),
        sa.Column("updated_at", UtcDateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("key"),
    )
    op.create_table(
        "contracts",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("vendor_key", sa.String(length=255), nullable=False),
        sa.Column("plan", sa.String(length=255), nullable=False),
        sa.Column("terms", sa.JSON(), nullable=False),
        sa.Column("origin", sa.String(length=16), nullable=False),
        sa.Column("updated_at", UtcDateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("vendor_key", "plan", name="uq_contracts_vendor_plan"),
    )
    with op.batch_alter_table("contracts", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_contracts_vendor_key"), ["vendor_key"], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("contracts", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_contracts_vendor_key"))
    op.drop_table("contracts")
    op.drop_table("vendors")
