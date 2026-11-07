/* eslint-disable @typescript-eslint/no-explicit-any -- PGlite rows are untyped in tests. */
// Fixtures of the professional portal on top of the PGlite world: price lists with tiers, two
// linked accounts (Profesional and a custom convenio) and one Auth user without an account.
import { IDS, asRole } from './pg-harness';
import type { World } from './pg-world';

export const U = {
  studio: '90000000-0000-4000-8000-000000000001',
  diego: '90000000-0000-4000-8000-000000000002',
  assistant: '90000000-0000-4000-8000-000000000003',
  plain: '90000000-0000-4000-8000-000000000004',
};
export const C = {
  studio: '91000000-0000-4000-8000-000000000001',
  diego: '91000000-0000-4000-8000-000000000002',
  retail: '91000000-0000-4000-8000-000000000003',
};

/**
 * Profesional: 10×15 Brillo 300 (100+ copias → 250), 10×15 Mate 320, 13×18 Brillo 600.
 * Convenio Diego: sólo 10×15 Brillo a 200, y puede pagar después. El público (500/800) no se toca.
 * `studio` (cliente «Estudio Luz», lista Profesional) paga antes de imprimir.
 */
export async function seedProfessionalWorld(w: World) {
  const rows = async (sql: string, args: unknown[] = []) =>
    (await w.db.query<any>(sql, args)).rows;
  const found = await rows(
    `select id, kind from public.price_lists where business_id=$1`,
    [IDS.business],
  );
  const diegoList = (
    await rows(
      `insert into public.price_lists(business_id,name,kind) values($1,'Convenio Diego','custom') returning id`,
      [IDS.business],
    )
  )[0].id as string;
  const lists = {
    public: found.find((x) => x.kind === 'public').id as string,
    professional: found.find((x) => x.kind === 'professional').id as string,
    diego: diegoList,
  };
  const glossy = async (service: string) =>
    (
      await rows(
        `select id from public.lab_variants where photo_service_id=$1 and paper='glossy'`,
        [service],
      )
    )[0].id as string;
  const glossy10 = await glossy(IDS.svc10x15);
  const glossy13 = await glossy(IDS.svc13x18);
  const matte10 = (
    await rows(
      `insert into public.lab_variants(business_id,photo_service_id,channel,paper)
       values($1,$2,'laboratory','matte') returning id`,
      [IDS.business, IDS.svc10x15],
    )
  )[0].id as string;
  const variants = { glossy10, glossy13, matte10 };
  const tier = (
    variant: string,
    list: string,
    min: number,
    max: number | null,
    cents: number,
  ) =>
    w.db.query(
      `insert into public.lab_price_tiers(business_id,variant_id,price_list_id,min_quantity,max_quantity,unit_price_cents)
       values($1,$2,$3,$4,$5,$6)`,
      [IDS.business, variant, list, min, max, cents],
    );
  await tier(glossy10, lists.professional, 1, 99, 30000);
  await tier(glossy10, lists.professional, 100, null, 25000);
  await tier(matte10, lists.professional, 1, null, 32000);
  await tier(glossy13, lists.professional, 1, null, 60000);
  await tier(glossy10, lists.diego, 1, null, 20000);
  await w.db.exec(`
    insert into auth.users(id,email) values
      ('${U.studio}','estudio@example.com'),('${U.diego}','diego@example.com'),
      ('${U.assistant}','asistente@example.com'),('${U.plain}','sin-cuenta@example.com');
  `);
  await w.db.query(
    `insert into public.customers(id,business_id,full_name,phone,price_list_id) values
      ($1,$4,'Estudio Luz','+54 9 342 555 0001',$5),
      ($2,$4,'Diego Fotógrafo','+54 9 342 555 0002',$6),
      ($3,$4,'Cliente de mostrador','+54 9 342 555 0003',null)`,
    [
      C.studio,
      C.diego,
      C.retail,
      IDS.business,
      lists.professional,
      lists.diego,
    ],
  );
  const link = (user: string, customer: string, deferred: boolean) =>
    asRole(w.db, 'service_role', null, () =>
      w.db.query(`select public.cc_professional_link($1,$2,$3,$4,$5)`, [
        IDS.business,
        user,
        customer,
        deferred,
        IDS.owner,
      ]),
    );
  await link(U.studio, C.studio, false);
  await link(U.diego, C.diego, true);
  return { lists, variants };
}
