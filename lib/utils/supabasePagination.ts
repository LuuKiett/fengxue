// Supabase/PostgREST caps any single select response at `db.max_rows` (1000 by
// default) regardless of .limit()/.range() bounds requested beyond that — a plain
// unpaginated query on dictionary_words silently truncated once Band B pushed the
// table past ~4800 rows (previously invisible at ~900 rows). Fetches in pages until
// a page comes back short, which is the only way to reliably get "all rows" past
// that cap without changing project-level PostgREST config.
const PAGE_SIZE = 1000

export async function fetchAllRows<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  const all: T[] = []
  let from = 0
  for (;;) {
    const { data, error } = await buildQuery(from, from + PAGE_SIZE - 1)
    if (error || !data) break
    all.push(...data)
    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return all
}
