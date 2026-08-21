import { FieldOsDb } from '../db/db';
import { Repositories } from '../db/repositories';

/** A fresh, isolated database + repositories for one test. */
export function makeTestRepos(name = `fieldos-test-${crypto.randomUUID()}`): {
  db: FieldOsDb;
  repos: Repositories;
  name: string;
} {
  const db = new FieldOsDb(name);
  return { db, repos: new Repositories(db), name };
}
