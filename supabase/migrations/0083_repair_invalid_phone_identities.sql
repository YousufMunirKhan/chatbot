-- ===========================================================================
-- Migration 0083 — Repair phone identities that were never valid E.164
--
-- `toE164` stripped non-digits and prefixed `+`, so a nationally-written number
-- became `+07946322081`. Nothing after a `+` may begin with a zero, so that is
-- not an international number at all. It reached the contact list, and it broke
-- both buttons beside it: a `tel:` link that will not dial and a wa.me link that
-- resolves to nothing.
--
-- The function no longer does that. These are the rows written before it stopped.
-- The leading `+` is dropped rather than a country code guessed — the national
-- form is at least true, and inventing a country would silently merge two
-- different people who happen to share a national number in different countries.
--
-- Merging is the reason for the conflict branch: if the corrected value already
-- exists for that company, the two rows are the same person, so the duplicate
-- identity is removed and its contact folded into the surviving one by the same
-- `contact_merge` the runtime uses.
-- ===========================================================================

do $$
declare
  r record;
  existing uuid;
begin
  for r in
    select id, company_id, contact_id, value
    from public.contact_identities
    where kind = 'phone' and value like '+0%'
  loop
    select ci.contact_id into existing
    from public.contact_identities ci
    where ci.company_id = r.company_id
      and ci.kind = 'phone'
      and ci.value = substring(r.value from 2)
    limit 1;

    if existing is null then
      update public.contact_identities
        set value = substring(r.value from 2)
        where id = r.id;
    else
      delete from public.contact_identities where id = r.id;
      if existing <> r.contact_id then
        perform public.contact_merge(r.company_id, existing, r.contact_id);
      end if;
    end if;
  end loop;
end $$;

-- The denormalised copy on the contact row, kept in step.
update public.contacts
set phones = (
  select coalesce(array_agg(distinct case when p like '+0%' then substring(p from 2) else p end), '{}')
  from unnest(phones) as p
)
where exists (select 1 from unnest(phones) as p where p like '+0%');
