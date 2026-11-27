/**
 * gen-db-types.js — introspect the live Supabase DB (public schema) and emit
 * src/lib/supabase/database.types.ts in the same shape as the previous file
 * (Tables / Views / Functions / Enums / CompositeTypes with Row/Insert/Update).
 *
 * Usage: node scripts/gen-db-types.js
 * Requires pg + .env.local (same connection style as scripts/dbq.js).
 */

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const root = path.join(__dirname, "..");
for (const line of fs.readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const OUT = path.join(root, "src/lib/supabase/database.types.ts");

/* ── Type mapping ─────────────────────────────────────────── */

const STRING_TYPES = new Set([
  "uuid", "text", "character varying", "character", "name", "citext",
  "inet", "bytea", "USER-DEFINED", // USER-DEFINED handled separately
]);

function tsTypeFor(dataType, udtName, enums, isArray) {
  if (isArray) return "Json";
  if (dataType === "USER-DEFINED") {
    if (enums.has(udtName)) return enumUnion(enums.get(udtName));
    return "Json";
  }
  if (dataType === "ARRAY") return "Json";
  switch (dataType) {
    case "boolean":
      return "boolean";
    case "smallint":
    case "integer":
    case "bigint":
    case "numeric":
    case "real":
    case "double precision":
    case "money":
    case "smallserial":
    case "serial":
    case "bigserial":
      return "number";
    case "json":
    case "jsonb":
      return "Json";
    case "date":
    case "time without time zone":
    case "time with time zone":
    case "timestamp without time zone":
    case "timestamp with time zone":
    case "interval":
      return "string";
    case "bytea":
    case "uuid":
    case "text":
    case "character varying":
    case "character":
    case "name":
    case "inet":
    case "cidr":
    case "macaddr":
    case "USER-DEFINED":
      return "string";
    default:
      return "Json";
  }
}

function enumUnion(labels) {
  return labels.map((l) => JSON.stringify(l)).join(" | ");
}

function ident(name) {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name) ? name : JSON.stringify(name);
}

/* ── Main ─────────────────────────────────────────────────── */

async function main() {
  const client = new Client({
    host: process.env.SUPABASE_POOLER_HOST || "aws-0-eu-west-1.pooler.supabase.com",
    port: 5432,
    user: `postgres.${process.env.SUPABASE_PROJECT_REF || "xruhvekcowdwocydqnmp"}`,
    password: process.env.SUPABASE_DB_PASSWORD,
    database: "postgres",
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  // Enums (pg_enum joined to pg_type, public schema only)
  const enumRes = await client.query(`
    SELECT t.typname, e.enumlabel
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
    ORDER BY t.typname, e.enumsortorder
  `);
  const enums = new Map(); // udt_name -> [labels]
  for (const r of enumRes.rows) {
    if (!enums.has(r.typname)) enums.set(r.typname, []);
    enums.get(r.typname).push(r.enumlabel);
  }

  // Columns for all tables + views in public schema
  const colRes = await client.query(`
    SELECT c.table_name, c.column_name, c.data_type, c.udt_name,
           c.is_nullable, c.column_default, c.is_identity, c.is_generated,
           (c.data_type = 'ARRAY') AS is_array
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
    ORDER BY c.table_name, c.ordinal_position
  `);

  const relRes = await client.query(`
    SELECT tc.table_name, kcu.column_name,
           ccu.table_name AS ref_table, ccu.column_name AS ref_column,
           tc.constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
  `);

  const rels = new Map(); // table -> [rel]
  for (const r of relRes.rows) {
    if (!rels.has(r.table_name)) rels.set(r.table_name, []);
    rels.get(r.table_name).push({
      foreignKeyName: r.constraint_name,
      columns: [r.column_name],
      isOneToOne: false,
      referencedRelation: r.ref_table,
      referencedColumns: [r.ref_column],
    });
  }

  const viewRes = await client.query(`
    SELECT table_name FROM information_schema.views WHERE table_schema = 'public'
  `);
  const viewNames = new Set(viewRes.rows.map((r) => r.table_name));

  // Materialized views (not in information_schema.views; columns via pg_attribute)
  const matviewRes = await client.query(`
    SELECT c.relname AS table_name, a.attname AS column_name,
           format_type(a.atttypid, a.atttypmod) AS data_type,
           a.attnotnull AS is_not_null
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    WHERE n.nspname = 'public' AND c.relkind = 'm'
    ORDER BY c.relname, a.attnum
  `);
  const matviewNames = new Set(matviewRes.rows.map((r) => r.table_name));

  // CHECK constraints of the form: col = ANY (ARRAY['a'::text, 'b'::text, ...])
  // → literal union types (mirrors the old hand-maintained enum columns).
  const checkRes = await client.query(`
    SELECT con.conrelid::regclass::text AS tbl,
           a.attname AS col,
           pg_get_constraintdef(con.oid) AS def
    FROM pg_constraint con
    JOIN pg_namespace n ON n.oid = con.connamespace
    JOIN unnest(con.conkey) AS k(attnum) ON true
    JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
    WHERE con.contype = 'c' AND n.nspname = 'public'
  `);
  // table.column -> [labels]
  const checkUnions = new Map();
  for (const r of checkRes.rows) {
    const tbl = r.tbl.replace(/^public\./, "");
    const m = r.def.match(/= ANY \(ARRAY\[(.+)\]\)/);
    if (!m) continue;
    const labels = [...m[1].matchAll(/'((?:[^']|'')*)'::/g)].map((x) => x[1].replace(/''/g, "'"));
    if (labels.length < 2) continue;
    const key = `${tbl}.${r.col}`;
    checkUnions.set(key, labels);
  }

  // Functions in public schema
  const fnRes = await client.query(`
    SELECT p.proname AS name,
           pg_get_function_arguments(p.oid) AS args_text,
           pg_get_function_result(p.oid) AS result_text,
           p.proretset AS returns_set
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind IN ('f', 'p')
    ORDER BY p.proname
  `);

  // Group columns by table
  const tables = new Map();
  for (const c of colRes.rows) {
    if (!tables.has(c.table_name)) tables.set(c.table_name, []);
    tables.get(c.table_name).push(c);
  }

  // Normalize matview columns into the same shape (pg_attribute/format_type)
  const matTables = new Map();
  for (const r of matviewRes.rows) {
    if (!matTables.has(r.table_name)) matTables.set(r.table_name, []);
    matTables.get(r.table_name).push({
      table_name: r.table_name,
      column_name: r.column_name,
      data_type: normalizePgTypeName(r.data_type),
      udt_name: r.data_type,
      is_nullable: r.is_not_null ? "NO" : "YES",
      column_default: null,
      is_identity: "NO",
      is_generated: "NEVER",
      is_array: /\[\]$/.test(r.data_type),
    });
  }

  const allTableNames = [...tables.keys()].filter((n) => !n.startsWith("pg_"));
  const tableNames = allTableNames.filter((n) => !viewNames.has(n));
  const viewList = [
    ...allTableNames.filter((n) => viewNames.has(n)),
    ...[...matTables.keys()].filter((n) => !viewNames.has(n)),
  ];

  /* ── Emit helpers ─────────────────────────────────────── */

  function normalizePgTypeName(t) {
    return String(t).replace(/\(.*\)/, "").replace(/^pg_catalog\./, "").replace(/^[a-z_]+\./, "");
  }

  function emitTable(name) {
    const cols = tables.get(name) || matTables.get(name) || [];
    const relList = rels.get(name) || [];

    const rowLines = [];
    const insLines = [];
    const updLines = [];

    for (const c of cols) {
      let base = tsTypeFor(c.data_type, c.udt_name, enums, c.is_array === true || c.data_type === "ARRAY");
      // CHECK-constrained text columns → literal unions
      const union = checkUnions.get(`${name}.${c.column_name}`);
      if (union && (base === "string" || base === "Json")) {
        base = enumUnion(union);
      }
      const nullable = c.is_nullable === "YES";
      // Row: non-nullable — matches prior hand-maintained types; Postgres
      // nullability drift made `| null` unusable at call sites.
      rowLines.push(`          ${ident(c.column_name)}: ${base};`);

      // Insert: optional when nullable, has default, identity, or generated
      const hasDefault = c.column_default !== null && c.column_default !== undefined;
      const isIdentity = c.is_identity === "YES";
      const isGenerated = c.is_generated !== "NEVER";
      const optional = nullable || hasDefault || isIdentity || isGenerated;
      const insType = nullable ? `${base} | null` : base;
      insLines.push(`          ${ident(c.column_name)}${optional ? "?" : ""}: ${insType};`);
      updLines.push(`          ${ident(c.column_name)}?: ${insType};`);
    }

    const relJson = relList.length
      ? relList.map((r) =>
          `{foreignKeyName:${JSON.stringify(r.foreignKeyName)},columns:${JSON.stringify(r.columns)},isOneToOne:false,referencedRelation:${JSON.stringify(r.referencedRelation)},referencedColumns:${JSON.stringify(r.referencedColumns)}}`
        ).join(",")
      : "";

    return `      ${ident(name)}: {
        Row: {
${rowLines.join("\n")}
        };
        Insert: {
${insLines.join("\n")}
        };
        Update: {
${updLines.join("\n")}
        };
        Relationships: [${relJson}];
      };`;
  }

  function emitFunction(fn) {
    // Parse args text like "p_user_id uuid, p_limit integer DEFAULT 10"
    const argsType = "Record<string, never>"; // args handled loosely below
    const argsObj = parseArgs(fn.args_text);
    const argsStr = Object.keys(argsObj).length
      ? `{ ${Object.entries(argsObj).map(([k, v]) => `${ident(k)}: ${v}`).join("; ")} }`
      : "Record<string, never>";
    const returns = mapFunctionResult(fn.result_text);
    return `      ${ident(fn.name)}: {
        Args: ${argsStr};
        Returns: ${returns};
      };`;
  }

  function parseArgs(argsText) {
    if (!argsText || !argsText.trim()) return {};
    const obj = {};
    // split on commas not inside parens
    const parts = [];
    let depth = 0, cur = "";
    for (const ch of argsText) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === "," && depth === 0) { parts.push(cur); cur = ""; }
      else cur += ch;
    }
    if (cur.trim()) parts.push(cur);
    for (const p of parts) {
      const cleaned = p.replace(/\s+DEFAULT\s+.*$/i, "").replace(/\s*:=.*$/i, "").trim();
      // modes: IN/OUT/INOUT/VARIADIC prefix
      const m = cleaned.match(/^(?:(?:IN|OUT|INOUT|VARIADIC)\s+)?([a-zA-Z_][\w$]*|"[^"]+")\s+(.+)$/);
      if (!m) continue;
      let name = m[1].replace(/"/g, "");
      let typeStr = m[2].trim();
      if (!name || name === "p" || /^\d/.test(name)) continue;
      obj[name] = tsTypeForPgType(typeStr);
    }
    return obj;
  }

  function tsTypeForPgType(typeStr) {
    const t = typeStr.toLowerCase();
    if (enums.has(typeStr) || enums.has(t)) {
      const labels = enums.get(typeStr) || enums.get(t);
      return enumUnion(labels);
    }
    if (/\[\]$/.test(t)) return "Json";
    if (/^(uuid|text|varchar|character varying|bpchar|citext|name|inet|jsonb?|xml|bytea)/.test(t)) {
      return /^(json|jsonb|xml)/.test(t) ? "Json" : "string";
    }
    if (/^(bool)/.test(t)) return "boolean";
    if (/^(int|integer|bigint|smallint|numeric|decimal|real|double|float|money|oid)/.test(t)) return "number";
    if (/^(timestamp|timestamptz|date|time|interval)/.test(t)) return "string";
    return "Json";
  }

  function mapFunctionResult(resultText) {
    if (!resultText) return "unknown";
    const t = resultText.trim();
    if (t === "trigger") return "unknown";
    if (t === "void") return "unknown";
    if (/^TABLE\(/i.test(t) || /^SETOF/i.test(t)) return "Json";
    if (/^(json|jsonb)/i.test(t)) return "Json";
    if (/^(uuid|text|varchar|character|name|inet|date|time|timestamp|interval)/i.test(t)) return "string";
    if (/^(bool)/i.test(t)) return "boolean";
    if (/^(int|integer|bigint|smallint|numeric|decimal|real|double|float|money|oid)/i.test(t)) return "number";
    if (enums.has(t)) return enumUnion(enums.get(t));
    if (/\[\]$/.test(t)) return "Json";
    return "Json";
  }

  /* ── Build file ───────────────────────────────────────── */

  const tableBlocks = tableNames.map(emitTable).join("\n");
  const viewBlocks = viewList.map(emitTable).join("\n");
  const fnBlocks = fnRes.rows.map(emitFunction).join("\n");

  const enumEntries = [...enums.entries()]
    .map(([name, labels]) => `      ${ident(name)}: ${enumUnion(labels)};`)
    .join("\n");

  const content = `/**
 * Supabase Database Types
 *
 * Generated from the live ODDLY database (public schema) by scripts/gen-db-types.js.
 * Provides type-safe access to all tables, views, functions and enums.
 *
 * Usage:
 *   import { createClient } from "@/lib/supabase/client";
 *   const supabase = createClient();
 *   const { data } = await supabase.from("fixtures").select("*");
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

// ============================================
// Database Schema
// ============================================

export interface Database {
  public: {
    Tables: {
${tableBlocks}
    };
    Views: {
${viewBlocks || "      [key: string]: never;"}
    };
    Functions: {
${fnBlocks || "      [key: string]: never;"}
    };
    Enums: {
${enumEntries}
    };
    CompositeTypes: Record<string, never>;
  };
}

// ============================================
// Helper Types
// ============================================

/** Shorthand for any table's Row type */
export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];

/** Shorthand for any table's Insert type */
export type TablesInsert<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];

/** Shorthand for any table's Update type */
export type TablesUpdate<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"];

/** Shorthand for any enum type */
export type Enums<T extends keyof Database["public"]["Enums"]> =
  Database["public"]["Enums"][T];
`;

  fs.writeFileSync(OUT, content);
  console.log(`Wrote ${OUT}`);
  console.log(`Tables: ${tableNames.length}, Views: ${viewList.length}, Functions: ${fnRes.rows.length}, Enums: ${enums.size}`);
  if (viewList.length) console.log("Views:", viewList.join(", "));

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
