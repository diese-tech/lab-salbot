# Incident Handling

Operational incidents affecting league operations. Use this during live incidents.

---

## Severity Levels

| Level | Description | Response Time |
|-------|-------------|---------------|
| P1 | Match results cannot be submitted or Supabase is unavailable | Immediate |
| P2 | Bot offline; matches in flight have pending actions unprocessed | < 30 min |
| P3 | `sal-site` degraded; Discord approvals still functional | < 4 hours |

---

## P1: Bot Cannot Accept Commands

Symptoms: `/report-result` returns an error or no response.

Steps:

1. Check bot process status
2. Check Supabase connectivity from bot (`GET /health` on Supabase URL)
3. Check Discord API status at discordstatus.com
4. Review bot error logs
5. If bot is down: restart process
6. If Supabase is down: inform affected captains, log pending submissions manually for later entry

Recovery after restart:
- All `pending_actions` with `status = 'pending'` are preserved in Supabase
- Admins can still inspect them through `sal-site`
- No data is lost from bot downtime

---

## P2: Pending Actions Stuck

Symptoms: Admin review cards not updating; approvals not executing.

Steps:

1. Check if bot is receiving Discord interaction events
2. Verify Supabase write permissions (`service_role` key in use)
3. Check for locked rows in `pending_actions` (uncommon but possible under high load)
4. Try approving through `sal-site` as a fallback

`sal-site` is the separate web/control-center application. Use its available admin tools when Discord interactions are broken.

---

## P1: Supabase Degraded

Full platform halt. Both salbot and `sal-site` depend on Supabase.

Steps:

1. Check Supabase status at status.supabase.com
2. Inform team of degraded state
3. Do not attempt manual database fixes during an active incident

Recovery:
- Platform resumes automatically when Supabase recovers
- No state is lost; all writes were either committed before the outage or rejected

---

## Post-Incident

After any P1, P2, or P3 incident:

1. Write a brief incident note (what happened, what was done, any data inconsistencies)
2. Check `pending_actions` for any stuck in `pending` state that need manual review
3. Check `audit_logs` for any gap in the timeline during the incident window
4. If any match mutations happened outside the normal pipeline during the incident, enter correction audit log entries through `sal-site`
