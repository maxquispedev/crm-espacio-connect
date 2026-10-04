import { getTableName, type SQL, type SQLWrapper } from "drizzle-orm";
import { PgDialect, type PgColumn } from "drizzle-orm/pg-core";
import { expect } from "vitest";

/**
 * Doble de BD en memoria para tests unitarios: el ORM, el `schema` y el
 * `scoped()` son REALES; lo único simulado es el ejecutor de PostgreSQL.
 *
 * Por qué importa: lo que se quiere comprobar aquí es que toda lectura/escritura
 * de dominio pase por `scoped()` y que un tenant NO vea las filas de otro. Un
 * doble que finge el WHERE no probaría nada de eso; este interpreta el SQL que
 * Drizzle genera (`"tabla"."columna" = $1`, `is null`, `in (...)`) y compara
 * contra los parámetros reales, incluido el `organization_id`.
 *
 * NO comprueba constraints de PostgreSQL (UNIQUE, CHECK, FK) ni tipos: para eso
 * está la suite opt-in `attention-postgres.test.ts`, que sí corre contra una base
 * real. Este doble cubre alcance de tenant, idempotencia del upsert y forma.
 */

export type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;

const dialect = new PgDialect();
const camel = (name: string) => name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

function asSql(value: unknown): SQL {
  return value as SQL;
}
/** Resuelve el valor de `.set()` cuando es una expresión SQL (`col + 1`). */
function resolveSetValue(row: Row, value: unknown): unknown {
  if (value instanceof Date || value === null || typeof value !== "object") return value;
  const sqlWrapper = value as SQLWrapper;
  if (!("queryChunks" in sqlWrapper)) return value;
  const query = dialect.sqlToQuery(asSql(value));
  const increment = /"\w+"\."(\w+)"\s*\+\s*\$?(\d+)?/.exec(query.sql);
  if (increment) {
    const [, column, addend] = increment;
    const previous = row[camel(column!)] ?? 0;
    return Number(previous) + Number(addend ?? "1");
  }
  // Expresión no soportada: se guarda como `null` en vez de inventar un valor.
  return null;
}

export function matches(row: Row, condition: SQL): boolean {
  const query = dialect.sqlToQuery(condition);
  // "col" = $N   (scoped() siempre emite el organization_id como el primero)
  const equals = [...query.sql.matchAll(/"\w+"\."(\w+)"\s*=\s*\$(\d+)/g)];
  // "col" is [not] null
  const nulls = [...query.sql.matchAll(/"\w+"\."(\w+)"\s+is\s+(not\s+)?null/g)];
  // "col" in ($1, $2)   (inArray: un placeholder POR VALOR)
  const included = [...query.sql.matchAll(/"\w+"\."(\w+)"\s+in\s*\(([^)]*)\)/g)];

  for (const match of equals) {
    if (row[camel(match[1]!)] !== query.params[Number(match[2]) - 1]) return false;
  }
  for (const match of nulls) {
    const isNull = row[camel(match[1]!)] === null || row[camel(match[1]!)] === undefined;
    if (match[2] ? isNull : !isNull) return false;
  }
  let inPlaceholders = 0;
  for (const match of included) {
    const list = [...match[2]!.matchAll(/\$(\d+)/g)];
    inPlaceholders += list.length;
    if (!list.map((p) => query.params[Number(p[1]) - 1]).includes(row[camel(match[1]!)])) {
      return false;
    }
  }

  // Cada parámetro emitido debe estar cubierto: si Drizzle genera una forma que
  // este doble no reconoce, el test falla aquí en vez de pasar en silencio.
  expect(equals.length + inPlaceholders).toBe(query.params.length);
  expect(equals.length + inPlaceholders + nulls.length).toBeGreaterThan(0);
  return true;
}

function sortRows(rows: Row[], conditions: SQL[]): Row[] {
  const specs = conditions.map((condition) => {
    const { sql } = dialect.sqlToQuery(condition);
    const match = /"\w+"\."(\w+)"\s+(asc|desc)/i.exec(sql);
    return { column: camel(match![1]!), direction: (match![2]! ?? "asc").toLowerCase() };
  });
  return [...rows].sort((a, b) => {
    for (const { column, direction } of specs) {
      const left = a[column];
      const right = b[column];
      if (left === right) continue;
      const result = left instanceof Date && right instanceof Date
        ? left.getTime() - right.getTime()
        : String(left) < String(right) ? -1 : 1;
      return direction === "desc" ? -result : result;
    }
    return 0;
  });
}

type Chain = {
  where: (condition: SQL) => Chain;
  orderBy: (...conditions: SQL[]) => Chain;
  limit: (n: number) => Promise<Row[]>;
  then: (
    onFulfilled: (value: Row[]) => unknown,
    onRejected?: (reason: unknown) => unknown
  ) => Promise<unknown>;
};

/** Cadena awaitable con `.where`, `.orderBy` y `.limit` encadenables. */
function chain(run: () => Row[]): Chain {
  const self = {
    where: (condition: SQL) => chain(() => run().filter((row) => matches(row, condition))),
    orderBy: (...conditions: SQL[]) => chain(() => sortRows(run(), conditions)),
    limit: (n: number) => Promise.resolve(run().slice(0, n)),
    then: (onFulfilled: (value: Row[]) => unknown, onRejected?: (reason: unknown) => unknown) =>
      Promise.resolve(run()).then(onFulfilled, onRejected),
  };
  return self as unknown as Chain;
}

/**
 * Defaults declarados en el `schema` que PostgreSQL rellena en el INSERT. Sin
 * ellos, una fila insertada vuelve con `createdAt: undefined` (y rompería
 * `serializeMessage`) o con `aiEnabled: undefined`, que un `handoffAt !== null`
 * leería como "la conversación es del humano". Se aplican solo a las columnas
 * ausentes.
 */
function applySchemaDefaults(row: Row): Row {
  const now = new Date();
  const defaults: Record<string, unknown> = { createdAt: now, updatedAt: now };
  if ("isTest" in row) defaults.isTest ??= false;
  if ("aiEnabled" in row) defaults.aiEnabled ??= true;
  if ("unreadCount" in row) defaults.unreadCount ??= 0;
  for (const [key, value] of Object.entries(defaults)) {
    if (row[key] === undefined) row[key] = value;
  }
  return row;
}

export function createMemDb(tables: Tables) {
  const bucketOf = (table: unknown): Row[] => {
    const name = getTableName(table as Parameters<typeof getTableName>[0]);
    const bucket = tables[name];
    if (!bucket) throw new Error(`tabla no declarada en el doble: ${name}`);
    return bucket;
  };

  return {
    tables,

    select: () => ({
      from: (table: unknown) => {
        const bucket = bucketOf(table);
        return chain(() => bucket.map((row) => ({ ...row })));
      },
    }),

    insert: (table: unknown) => ({
      values: (value: Row) => ({
        onConflictDoUpdate: (conflict: {
          target: PgColumn[];
          set: Row;
          setWhere?: SQL;
        }) => ({
          returning: () => {
            const bucket = bucketOf(table);
            const previous = bucket.find((row) =>
              conflict.target.every((column) => row[camel(column.name)] === value[camel(column.name)])
            );
            if (previous) {
              if (conflict.setWhere && !matches(previous, conflict.setWhere)) return [];
              for (const [key, entry] of Object.entries(conflict.set)) {
                previous[key] = resolveSetValue(previous, entry);
              }
              return [{ ...previous }];
            }
            const row: Row = { ...value };
            for (const [key, entry] of Object.entries(row)) {
              row[key] = resolveSetValue(row, entry);
            }
            applySchemaDefaults(row);
            bucket.push(row);
            return [{ ...row }];
          },
        }),
        onConflictDoNothing: (conflict: { target?: PgColumn[] } = {}) => ({
          returning: () => {
            const bucket = bucketOf(table);
            // Sin `target`, PostgreSQL deduplica por cualquier UNIQUE en
            // conflicto. Aquí se conoce el único caso de dominio que los tests
            // ejercitan: una conversación real por (organization, contact)
            // (`conversation_org_contact_real_uq`, parcial sobre is_test=false),
            // que es justo de lo que depende `getOrCreateConversation`.
            const keys = conflict.target
              ? conflict.target.map((column) => camel(column.name))
              : "organizationId" in value && "contactId" in value
                ? ["organizationId", "contactId"]
                : [];
            const duplicate =
              keys.length > 0 &&
              bucket.some((row) => keys.every((key) => row[key] === value[key]));
            if (duplicate) return [];
            const row = applySchemaDefaults({ ...value });
            bucket.push(row);
            return [{ ...row }];
          },
        }),
        returning: () => {
          const bucket = bucketOf(table);
          const row = applySchemaDefaults({ ...value });
          bucket.push(row);
          return [{ ...row }];
        },
      }),
    }),

    update: (table: unknown) => ({
      set: (patch: Row) => ({
        where: (condition: SQL) => ({
          returning: () => {
            const bucket = bucketOf(table);
            const touched = bucket.filter((row) => matches(row, condition));
            for (const row of touched) {
              for (const [key, entry] of Object.entries(patch)) {
                row[key] = resolveSetValue(row, entry);
              }
            }
            return touched.map((row) => ({ ...row }));
          },
        }),
      }),
    }),

    delete: (table: unknown) => ({
      where: (condition: SQL) => ({
        returning: () => {
          const bucket = bucketOf(table);
          const touched = bucket.filter((row) => matches(row, condition));
          for (const row of touched) bucket.splice(bucket.indexOf(row), 1);
          return touched.map((row) => ({ ...row }));
        },
      }),
    }),
  };
}

export type MemDb = ReturnType<typeof createMemDb>;
