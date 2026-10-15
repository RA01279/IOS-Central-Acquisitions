-- The exit cap an analyst sets for a deal. Comp-based exit value divides the
-- comps' market rent at exit by it. A fraction (0.065 = 6.5%), like the
-- model's exitCapPct; null means "use the uploaded model's exit cap".
alter table deals
  add column if not exists exit_cap_rate numeric
    constraint deals_exit_cap_rate_sane check (exit_cap_rate is null or (exit_cap_rate > 0 and exit_cap_rate < 0.25));
