-- Sessions must die when the password changes: the JWT strategy has no
-- server-side session store, so the user row carries the cutoff instant and
-- authz compares each token's issue time against it.
ALTER TABLE "users" ADD COLUMN "password_changed_at" text;
