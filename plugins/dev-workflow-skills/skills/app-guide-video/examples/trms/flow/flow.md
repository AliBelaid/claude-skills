# TRMS full flow (script of the video)

Business chain, each step needs the record made by the one before:
patient → claim (with invoice and services) → batch assigned to reviewer → review started →
claim final-approved → review completed → sent to manager → manager final approval →
independent audit by another reviewer → voucher for the month → voucher issued → user created.

Screens read for this flow: `app.routes.ts` (mail-review, review-approval, audit, users, vouchers),
`patient-create.component.html` (test IDs `pc-*`), `claim-entry.component.ts` (labels `ce-*`, `csi-*`,
`sl-*`), `service-line-dialog` (labelled inputs), `user-form.component.html` (`uf-role`),
`review-approval-detail.component.html` (stage buttons), batch detail (buttons), voucher form (month inputs).

| # | Chapter | Records made | Needs |
|---|---|---|---|
| 01 | navigation | none | - |
| 02 | patient | patient (NID, names) | RUN, NID |
| 03 | claim | claim, batch | NID, RUN → captures BATCH_ID |
| 04 | approvals | review stages | BATCH_ID |
| (hook) | audit clearance | claim audit status | BATCH_ID, reviewer login (API) |
| 05 | audit | - | BATCH_ID |
| 06 | voucher create | voucher | MONTH → captures VOUCHER_ID |
| 07 | voucher issue | voucher issued | VOUCHER_ID |
| 08 | user | user | RUN, USER_PASSWORD |

Rules learned on this app:
- Native `<select>` in the assign-reviewer modal (`.modal-card select.form-select`, index 3 is a medical reviewer).
- Party type button text is `بدون مزوّد` (with shadda).
- The header global search also says "بحث": scope the patient-card search with `button:text-is("بحث") >> nth=-1`.
- Approval buttons carry icon prefixes (`✓✕ موافق عليها…`), so match loosely.
- The batch must be final-approved (review-approval screen, not the legacy "توقيع / إرسال للإدارة المالية" path)
  and every claim in the batch must be independently audited by a different user before a voucher opens.
- A voucher is refused while any batch of the same month is not final-approved. Use a fresh month per run.
- The claim's reviewer cannot audit the same claim. The audit is recorded by the reviewer account via the
  API hook, and the video says so in the narration.
