import { neon } from '@neondatabase/serverless';

export function createStore(query) {
  return {
    async save({ name, email }) {
      await query(`INSERT INTO mailing_list_signups(email, name) VALUES ($1, $2)
        ON CONFLICT (email) DO NOTHING`, [email, name]);
    },
    async allow(key) {
      const rows = await query(`INSERT INTO mailing_list_limits(key, count, expires_at)
        VALUES ($1, 1, now() + interval '1 hour')
        ON CONFLICT (key) DO UPDATE SET
          count = CASE WHEN mailing_list_limits.expires_at <= now() THEN 1 ELSE mailing_list_limits.count + 1 END,
          expires_at = CASE WHEN mailing_list_limits.expires_at <= now() THEN now() + interval '1 hour' ELSE mailing_list_limits.expires_at END
        RETURNING count`, [key]);
      return rows[0].count <= 60;
    },
    async claim(email = null) {
      return query(`UPDATE mailing_list_signups SET lease_until = now() + interval '2 minutes', attempts = attempts + 1
        WHERE email IN (SELECT email FROM mailing_list_signups
          WHERE synced_at IS NULL AND next_attempt_at <= now()
            AND (lease_until IS NULL OR lease_until < now()) AND ($1::text IS NULL OR email = $1)
          ORDER BY next_attempt_at LIMIT 1 FOR UPDATE SKIP LOCKED)
        RETURNING email, name, attempts`, [email]);
    },
    async delivered(email) {
      await query(`UPDATE mailing_list_signups SET synced_at = now(), lease_until = NULL, last_error = NULL
        WHERE email = $1`, [email]);
    },
    async retry(email, attempts) {
      const delay = Math.min(3600, 60 * 2 ** Math.min(attempts, 6));
      await query(`UPDATE mailing_list_signups SET lease_until = NULL, last_error = 'sheet_unavailable',
        next_attempt_at = now() + ($2 * interval '1 second') WHERE email = $1`, [email, delay]);
    },
    async health(id) {
      await query(`INSERT INTO mailing_list_health(id) VALUES ($1) ON CONFLICT (id) DO UPDATE SET checked_at = now()`, [id]);
      await query(`DELETE FROM mailing_list_health WHERE checked_at < now() - interval '1 day' OR id = $1`, [id]);
      await query(`DELETE FROM mailing_list_limits WHERE expires_at < now()`, []);
      const rows = await query(`SELECT count(*)::int AS pending,
        count(*) FILTER (WHERE created_at < now() - interval '15 minutes')::int AS overdue
        FROM mailing_list_signups WHERE synced_at IS NULL`, []);
      return rows[0];
    }
  };
}

export function configuredStore() {
  if (!process.env.DATABASE_URL) throw new Error('database_not_configured');
  const sql = neon(process.env.DATABASE_URL);
  return createStore((query, params) => sql.query(query, params, {
    fetchOptions: { signal: AbortSignal.timeout(8000) }
  }));
}
