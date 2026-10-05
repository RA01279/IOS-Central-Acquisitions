-- The one-paragraph recommendation on the IC summary slide (/deals/[id]/ic-deck).
-- Free text, edited on the slide preview itself.
alter table deals add column if not exists ic_recommendation text;
