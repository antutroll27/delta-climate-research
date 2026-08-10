from collections.abc import Sequence

from pyarrow import Table

def read_table(source: str, columns: Sequence[str] | None = ...) -> Table: ...
