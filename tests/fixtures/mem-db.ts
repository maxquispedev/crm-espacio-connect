import { Column, getTableName, is, type SQL, type SQLWrapper } from "drizzle-orm";
import { PgDialect, type PgColumn } from "drizzle-orm/pg-core";
import { expect } from "vitest";

/**
 * Doble de BD en memoria para tests unitarios: el ORM, el `schema` y el
 * `scoped()` son REALES; lo único simulado es el ejecutor de PostgreSQL.
 *
 * Por qué importa: lo que se quiere comprobar aquí es que toda lectura/escritura
 * de dominio pase por `scoped()` y que un tenant NO vea las filas de otro. Un
 * doble que finge el WHERE no probaría nada de eso; este interpreta el SQL que
 * Drizzle genera (`"tabla"."columna" = $1`, `is null`, `in (...)`, y también
 * `"t1"."col" = "t2"."col"` de un JOIN) y compara contra los parámetros reales,
 * incluido el `organization_id`.
 *
 * NO comprueba constraints de PostgreSQL (UNIQUE, CHECK, FK) ni tipos: para eso
 * está la suite opt-in `attention-migration.test.ts`, que sí corre contra una
 * base real. Este doble cubre alcance de tenant, idempotencia del upsert, forma
 * del DTO y el aislamiento de los JOIN.
 */

export type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;

const dialect = new PgDialect();
const camel = (name: string) => name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

function nameOf(table: unknown): string {
  return getTableName(table as Parameters<typeof getTableName>[0]);
}

/** ¿Es el valor una tabla del schema (y no un `sql` subquery proyectado)? */
function isTable(value: unknown): boolean {
  try {
    return typeof getTableName(value as Parameters<typeof getTableName>[0]) === "string";
  } catch {
    return false;
  }
}

/**
 * Proyecta una columna suelta (`select({ id: conversation.id })`): el valor sale
 * de la fila de SU tabla. Sin esto, esas proyecciones devolvían `null` y
 * `clearAttentionForContact` — que primero lista ids de conversación — dejaba de
 * borrar nada.
 */
function projectValue(value: unknown, row: Joined): unknown {
  if (isTable(value)) return row[nameOf(value)] ?? null;
  if (is(value, Column)) {
    return row[nameOf(value.table)]?.[camel(value.name)] ?? null;
  }
  // Subquery `sql`: no imitable aquí (documentado en `select`).
  return null;
}

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

/** Una fila "unida" por tabla: `{ conversation: {...}, contact: {...} }`. */
type Joined = Record<string, Row | undefined>;

/**
 * Núcleo de la evaluación de condiciones.
 *
 * `getRow` resuelve `"tabla"` → fila. Con una sola tabla se pasa una función que
 * siempre devuelve esa fila; en un JOIN se pasa la fila unida, y así se pueden
 * decidir las comparaciones ENTRE TABLAS que emite Drizzle sin parámetros:
 * `eq(conversationAttention.conversationId, conversation.id)` compila a
 * `"conversation_attention"."conversation_id" = "conversation"."id"`.
 *
 * `focus` es la tabla contra la que se evalúan las condiciones CON valor
 * (parámetros, `is null`, `in`): la tabla del ON en un JOIN, la del WHERE en la
 * consulta. Si alguna de las dos filas de una comparación entre tablas no está en
 * la unión, se lanza: mejor un test rojo que un JOIN que finge que todo empareja.
 */
function evalCondition(
  getRow: (table: string) => Row | undefined,
  focus: string,
  condition: SQL
): boolean {
  const query = dialect.sqlToQuery(condition);
  // "col" = $N   (scoped() siempre emite el organization_id como el primero)
  const differs = [...query.sql.matchAll(/"\w+"\."(\w+)"\s*<>\s*\$(\d+)/g)];
  const equals = [...query.sql.matchAll(/"\w+"\."(\w+)"\s*=\s*\$(\d+)/g)];
  // "t1"."col" = "t2"."col"   (entre tablas, sin parámetros)
  const columnEquals = [...query.sql.matchAll(/"(\w+)"\."(\w+)"\s*=\s*"(\w+)"\."(\w+)"/g)];
  // "col" is [not] null
  const nulls = [...query.sql.matchAll(/"\w+"\."(\w+)"\s+is\s+(not\s+)?null/g)];
  // "col" in ($1, $2)   (inArray: un placeholder POR VALOR)
  const included = [...query.sql.matchAll(/"\w+"\."(\w+)"\s+in\s*\(([^)]*)\)/g)];

  for (const match of columnEquals) {
    const left = getRow(match[1]!);
    const right = getRow(match[3]!);
    if (!left || !right) {
      throw new Error(
        `mem-db: comparación entre tablas sin fila para "${match[1]}" / "${match[3]}"`
      );
    }
    if (left[camel(match[2]!)] !== right[camel(match[4]!)]) return false;
  }

  const own = getRow(focus);
  const value = (column: string): unknown => {
    if (!own) throw new Error("mem-db: condición sin fila que evaluar");
    return own[camel(column)];
  };
  for (const match of equals) {
    const left = value(match[1]!), right = query.params[Number(match[2]!) - 1];
    if (left instanceof Date ? left.getTime() !== new Date(right as string | Date).getTime() : left !== right) return false;
  }
  for (const match of differs) {
    if (value(match[1]!) === query.params[Number(match[2]!) - 1]) return false;
  }
  for (const match of nulls) {
    const isNull = value(match[1]!) === null || value(match[1]!) === undefined;
    if (match[2] ? isNull : !isNull) return false;
  }
  let inPlaceholders = 0;
  for (const match of included) {
    const list = [...match[2]!.matchAll(/\$(\d+)/g)];
    inPlaceholders += list.length;
    const column = value(match[1]!);
    if (!list.map((p) => query.params[Number(p[1]!) - 1]).includes(column)) {
      return false;
    }
  }

  // Cada parámetro emitido debe estar cubierto: si Drizzle genera una forma que
  // este doble no reconoce, el test falla aquí en vez de pasar en silencio.
  expect(equals.length + differs.length + inPlaceholders).toBe(query.params.length);
  expect(equals.length + differs.length + inPlaceholders + nulls.length + columnEquals.length)
    .toBeGreaterThan(0);
  return true;
}

/** Condición de una sola tabla (WHERE/UPDATE/DELETE sobre un bucket). */
export function matches(row: Row, condition: SQL): boolean {
  return evalCondition(() => row, "", condition);
}

type SortSpec = { table: string; column: string; direction: string };

function sortSpecs(conditions: SQL[]): SortSpec[] {
  return conditions
    .map((condition) => {
      const { sql } = dialect.sqlToQuery(condition);
      const match = /"(\w+)"\."(\w+)"\s+(asc|desc)/i.exec(sql);
      // Una condición que no sea un ORDER BY de columna simple (p. ej. el
      // `desc(coalesce("conversation"."last_message_at", ...))` de
      // `listConversations`) no se sabe imitar aquí. Antes esto reventaba con un
      // TypeError al desenlazar `null`; ahora se ignora esa condición y se
      // conserva el orden de entrada, que es justo lo que un test de la forma del
      // DTO necesita. Los tests que sí afirmen sobre el ORDEN deben sembrar un
      // orden por columna simple.
      if (!match) return null;
      return {
        table: match[1]!,
        column: camel(match[2]!),
        direction: (match[3] ?? "asc").toLowerCase(),
      };
    })
    .filter((spec): spec is SortSpec => spec !== null);
}

function ordenar(entries: [SortSpec[], Joined][]): Joined[] {
  if (entries.length === 0) return entries.map(([, joined]) => joined);
  return entries
    .sort(([specs, left], [, right]) => {
      for (const { table, column, direction } of specs) {
        const l = left[table]?.[column];
        const r = right[table]?.[column];
        if (l === r) continue;
        const result = l instanceof Date && r instanceof Date
          ? l.getTime() - r.getTime()
          : String(l) < String(r) ? -1 : 1;
        return direction === "desc" ? -result : result;
      }
      return 0;
    })
    .map(([, joined]) => joined);
}

function sortRows(rows: Row[], conditions: SQL[]): Row[] {
  const specs = sortSpecs(conditions);
  if (specs.length === 0) return rows;
  return ordenar(rows.map((row) => [specs, { "": row }] as [SortSpec[], Joined])).map(
    (joined) => joined[""] as Row
  );
}

type Chain = {
  for: (mode: string) => Chain;
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
    for: () => self,
    where: (condition: SQL) =>
      chain(() => run().filter((row) => matches(row, condition))),
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
    const name = nameOf(table);
    const bucket = tables[name];
    if (!bucket) throw new Error(`tabla no declarada en el doble: ${name}`);
    return bucket;
  };

  const db = {
    tables,

    /**
     * 013 C2 — Soporta la proyección por tabla y los JOIN que usa
     * `listConversations` (`innerJoin` de contacto + dos `leftJoin`).
     *
     * Por qué importa: la garantía que hay que comprobar sobre esta query NO es
     * "la función devuelve algo", sino que la fila de atención se resuelve en el
     * MISMO SELECT y **con el `organization_id` dentro del ON**. Para poder
     * afirmar eso sobre la query REAL (no sobre una reimplementación) el doble
     * tiene que interpretar el ON de cada join, incluida la comparación entre
     * tablas, y dejar que una fila de atención de otra organización NO se pegue a
     * una conversación de esta.
     *
     * Límites declarados: las columnas proyectadas que NO son tablas (los
     * subqueries `preview`/`stageName` de `listConversations`) devuelven `null`; no
     * se imita SQL arbitrario. Sin proyección, el comportamiento es el de siempre
     * (fila plana), así que los tests previos siguen valiendo sin cambios.
     */
    select: (projection?: Record<string, unknown>) => {
      let base: unknown;
      const joins: { table: unknown; on: SQL; outer: boolean }[] = [];

      const project = (joined: Joined[]): Row[] => {
        if (!projection) {
          return joined.map((row) => {
            const flat: Row = {};
            for (const [key, value] of Object.entries(row)) {
              if (value === undefined) continue;
              flat[key] = value;
            }
            return flat;
          });
        }
        return joined.map((row) => {
          const projected: Row = {};
          for (const [key, value] of Object.entries(projection)) {
            projected[key] = projectValue(value, row);
          }
          return projected;
        });
      };

      const build = (): Joined[] => {
        if (!base) throw new Error("select() sin from()");
        const baseName = nameOf(base);
        let rows: Joined[] = bucketOf(base).map((row) => ({ [baseName]: row }));
        for (const join of joins) {
          const tableName = nameOf(join.table);
          const candidates = bucketOf(join.table);
          const next: Joined[] = [];
          for (const current of rows) {
            const found = candidates.filter((candidate) =>
              evalCondition(
                (table) => current[table] ?? (table === tableName ? candidate : undefined),
                tableName,
                join.on
              )
            );
            if (found.length === 0) {
              // LEFT JOIN sin coincidencia: la fila sigue, con la tabla a null.
              if (join.outer) next.push(current);
              continue;
            }
            for (const candidate of found) next.push({ ...current, [tableName]: candidate });
          }
          rows = next;
        }
        return rows;
      };

      // Drizzle encadena los joins sobre lo anterior (`.from().innerJoin()
      // .leftJoin()`), así que TODOS los eslabones de la cadena deben ofrecer
      // `innerJoin`/`leftJoin`, no solo el primero.
      const joiner = {
        innerJoin: (table: unknown, on: SQL) => {
          joins.push({ table, on, outer: false });
          return chainable();
        },
        leftJoin: (table: unknown, on: SQL) => {
          joins.push({ table, on, outer: true });
          return chainable();
        },
      };

      const chainable = () => {
        const state: { rows: Joined[] } = { rows: build() };
        const api = Object.assign(
          {
            for: () => api,
            where: (condition: SQL) => {
              state.rows = state.rows.filter((joined) =>
                evalCondition((table) => joined[table], nameOf(base), condition)
              );
              return api;
            },
            orderBy: (...conditions: SQL[]) => {
              const specs = sortSpecs(conditions);
              state.rows = ordenar(
                state.rows.map((joined) => [specs, joined] as [SortSpec[], Joined])
              );
              return api;
            },
            limit: (n: number) => Promise.resolve(project(state.rows).slice(0, n)),
            then: (
              onFulfilled: (value: Row[]) => unknown,
              onRejected?: (reason: unknown) => unknown
            ) => Promise.resolve(project(state.rows)).then(onFulfilled, onRejected),
          },
          joiner
        );
        return api;
      };

      return {
        from: (table: unknown) => {
          base = table;
          // Sin proyección ni joins, la fila plana de siempre.
          if (joins.length === 0 && !projection) {
            return Object.assign(
              chain(() => {
                const rows = build();
                return rows.map((joined) => Object.values(joined)[0] as Row);
              }),
              joiner
            );
          }
          return chainable();
        },
        innerJoin: joiner.innerJoin,
        leftJoin: joiner.leftJoin,
      };
    },

    insert: (table: unknown) => ({
      values: (value: Row) => ({
        then: (resolve: (rows: Row[]) => unknown, reject?: (err: unknown) => unknown) => Promise.resolve().then(() => {
          const row = applySchemaDefaults({ ...value }); bucketOf(table).push(row); return [{ ...row }];
        }).then(resolve, reject),
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
        where: (condition: SQL) => {
          const run = () => {
            const touched = bucketOf(table).filter(row => matches(row, condition));
            for (const row of touched) for (const [key, entry] of Object.entries(patch)) row[key] = resolveSetValue(row, entry);
            return touched.map(row => ({ ...row }));
          };
          return { returning: run, then: (resolve: (rows: Row[]) => unknown, reject?: (err: unknown) => unknown) => Promise.resolve().then(run).then(resolve, reject) };
        },
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
  let lastTransaction: Promise<unknown> = Promise.resolve();
  const transaction = <T>(run: (tx: typeof db) => Promise<T>): Promise<T> => {
    const next = lastTransaction.then(async () => {
      const before = structuredClone(tables);
      try { return await run(db); }
      catch (err) { for (const key of Object.keys(tables)) tables[key] = before[key]!; throw err; }
    });
    lastTransaction = next.catch(() => undefined);
    return next;
  };
  return { ...db, transaction };
}

export type MemDb = ReturnType<typeof createMemDb>;
