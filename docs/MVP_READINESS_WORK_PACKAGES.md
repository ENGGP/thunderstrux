# MVP Readiness Work Packages

These packages group the steps in `MVP_READINESS_PLAN.md` by related implementation work. Each package contains smaller checkpoints so the implementation remains manageable.

| Package | Steps | Internal checkpoints |
|---|---|---|
| 1. Account lifecycle | T02–T04 | Notification foundation → verification → password recovery/settings, email changes and permanent closure |
| 2. Staff and permissions | T05–T06 | Permissions/context → invitations and handover |
| 3. Society profiles and discovery | T07–T09 | Safe assets → profiles → discovery/join |
| 4. Ticket foundations | T10–T13 | Snapshots/readiness → inventory locking → free tickets |
| 5. Paid checkout and Connect | **T14, then T17** | Checkout recovery → Connect safety and fee disclosure |
| 6. Public and guest journeys | T15–T16 | Public pages → verified guest access |
| 7. Refunds and attendee experience | T18–T19 | Refund correctness → purchases, wallet and attendance |
| 8. Membership commerce | T20–T24 | Commerce foundation/payment dispatcher → membership products → fulfilment/UI |
| 9. Merchandise | T25–T28 | Catalogue/cart → inventory/checkout → pickup/returns |
| 10. Integrated member/operator experience | T29–T34 | Unified orders/email → authoritative analytics → calendar/dashboards |
| 11. Controlled OpenClaw actions | T35–T37 | Shared action registry → confirmation receipts → AI interface |
| 12. Security and reliability | T38–T42 | Audit → security → accessibility → integrity/recovery/workers |
| 13. Release qualification | T43–T44 | Follow their existing ordered substeps |
| 14. Provider acceptance and final audit | T45–T46 | Real provider verification → final PRD completeness audit |

## Package 1 delivery

T02 notification foundation, T03 verification and T04a recovery/settings and T04b email changes are delivered through PRs #31, #32, #33 and #36. **Package 1 implementation and qualification are complete.** T04c permanent closure is delivered through [PR #37](https://github.com/ENGGP/thunderstrux/pull/37), with three unchanged-content complete local and CI browser passes, migration/restore coverage and protected-main delivery checks. Detailed scope, regressions, migrations, restore/browser evidence and remaining production activation gates are recorded in [MVP Readiness Plan](MVP_READINESS_PLAN.md). Account closure anonymises login/editable profile while retaining business, attendance, buyer contact and audit/security records; a new signup never inherits them. No runtime migration/redeployment or hosted activation has been performed.

## Package 2 delivery

T05 permissions and explicit personal/staff context are implemented and locally qualified in [PR #42](https://github.com/ENGGP/thunderstrux/pull/42). T06a private invitations are implemented and locally qualified in [PR #43](https://github.com/ENGGP/thunderstrux/pull/43). T06b committee handover is implemented and locally qualified in [PR #44](https://github.com/ENGGP/thunderstrux/pull/44). **Package 2 implementation and local qualification are complete.** Handover preserves business/Stripe history, promotes incoming ownership before outgoing admin/revocation, and retires the legacy ownership pointer without transferring credentials. The readiness plan records the baseline/browser evidence and independent review gate. No runtime or hosted activation has been performed.
