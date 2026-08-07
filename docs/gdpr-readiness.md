# GDPR readiness record

Last reviewed: 7 August 2026

## Status

This document records the site's current privacy-by-design baseline. It is not a
claim that Delta Climate Research is legally GDPR compliant, and it is not a
substitute for legal advice.

The public privacy notice is intentionally blocked until both required
controller details are available:

- Legal controller: pending registration and confirmation of the LLP's exact
  legal name.
- Registered/full postal address: pending confirmation.
- Privacy and data-rights contact: `management@deltaclimate.earth`.

Do not publish a placeholder controller identity or address. Once those details
exist, publish the notice before inviting EU/EEA visitors or using the site for
commercial lead generation.

## Technical baseline now in code

- Vercel Web Analytics and Speed Insights are mounted in the shared site layout.
  The owner approved restoring both on 7 August 2026 to obtain aggregated traffic
  and real-user performance data. Their processing must be disclosed in the
  public privacy notice and remains subject to the plan/contract blocker below.
- The browser requests Climate Clock data from `/api/climate-clock`. The Vercel
  function calls Climate Clock and caches the public response, so the upstream
  does not receive each visitor's IP address or browser request metadata.
- The heat-map weather request already uses `/api/live`. Its met.no identifier
  now uses the organisational contact instead of a personal Gmail address.
- No advertising, behavioural-tracking, account, checkout, newsletter, or
  contact-form code was found in the current application.
- The CBAM calculator runs in the browser. The present implementation does not
  submit calculator inputs to a Delta backend.

## Current data-flow register

| Activity | Data and recipient | Purpose / current basis | Retention and action |
| --- | --- | --- | --- |
| Site delivery and security | Vercel may receive IP address, request headers, URL, timestamps, and operational logs | Deliver and protect the site; document a legitimate-interests assessment before launch | Confirm actual Hobby-plan logging/retention and deletion controls. Resolve the processor-contract blocker below. |
| Vercel Web Analytics / Speed Insights | Vercel receives page-view/request attributes and real-user performance measurements; its Web Analytics documentation describes cookieless, aggregated reporting and a daily-reset visitor hash | Understand traffic and diagnose real-user performance; document the chosen lawful basis and necessity/balancing assessment | Hobby currently provides a one-month Analytics reporting window and seven-day Speed Insights window. Disclose both products and Vercel as recipient; complete the transfer assessment and resolve plan-level processor terms before commercial launch. |
| Climate Clock feed | Visitor calls Delta's same-origin endpoint; Climate Clock receives the Vercel function's request metadata | Display public climate-clock data; no visitor identifier is intentionally forwarded | Browser session cache expires after 24 hours; CDN shared cache is one hour with stale revalidation. Assess and record Climate Clock as a recipient/vendor before the public notice. |
| met.no weather feed | Visitor calls Delta's same-origin endpoint; met.no receives Vercel request metadata and a location selected by the heat-map code | Display contextual weather; no visitor identifier is intentionally forwarded | CDN shared cache is ten minutes. Keep the endpoint limited to the coordinates needed by the product if abuse becomes a concern. |
| OpenFreeMap map styles/tiles | The heat-map browser contacts OpenFreeMap infrastructure directly, exposing ordinary request metadata such as IP address, requested resource, and headers | Render the interactive basemap; lawful basis and necessity assessment pending | Confirm vendor identity, infrastructure location, logs, retention, transfer safeguards, and attribution/privacy terms. Proxy or self-host if the result is unsuitable. |
| Functional browser storage | Session keys `delta:loaded`, `delta-holo`, `delta:hm-tip`, and `cc:clock`; persistent preference `delta:heat-clock-h12` | Remember UI state or a user-selected display preference; no cross-site tracking | Session values end with the browser session (the clock entry also has a 24-hour application expiry). The 12/24-hour preference persists until cleared. List these in the final notice. |
| Email enquiries | A visitor deliberately opens their email client through a `mailto:` link; Delta and the visitor's email provider process the message and addresses | Respond to an enquiry; choose and document the basis appropriate to the enquiry | Define mailbox access, deletion, and enquiry-retention rules. Provide the privacy notice at or before collection where practical. |
| Public team profiles | Names, photos, biographies, roles, and work email addresses are published | Organisational representation; basis and evidence pending | Obtain written approval from each person or document the chosen lawful basis, scope, review date, and removal process. |
| CBAM calculator | User-entered calculation data remains in the browser in the current implementation | Provide the requested calculation | Re-audit before adding APIs, server logs, saved projects, accounts, analytics, or exports that transmit input data. |

Vercel documents these integrations as cookieless; the browser does not currently
set advertising cookies. That does not remove the transparency, lawful-basis,
vendor, transfer, and jurisdiction-specific ePrivacy analysis. Do not add a
generic consent banner merely for appearance: first inventory the exact storage
and tracking technologies and obtain advice for the visitor's jurisdiction.
Reassess whenever a new SDK, embed, form, analytics product, or storage key is
added.

## Blocking legal and operational work

1. Confirm the LLP's exact registered name, full postal address, and the
   countries from which it offers services. Identify any EU/EEA establishment or
   representative requirement with counsel.
2. Move production/commercial processing off Vercel Hobby or obtain terms that
   cover the intended processing. Vercel's current Data Processing Addendum says
   it applies to Pro and Enterprise customers, so Hobby must not be treated as
   though that DPA already applies.
3. Decide and document the lawful basis for each activity. Where relying on
   legitimate interests, complete a written purpose/necessity/balancing test.
4. Approve a retention schedule for hosting logs, email enquiries, rights
   requests, team-profile evidence, backups, and any future lead data.
5. Establish a rights-request workflow for access, rectification, erasure,
   restriction, objection, portability where applicable, and identity checks.
   Record request dates and responses without collecting excessive proof.
6. Complete processor/vendor due diligence and international-transfer analysis
   for Vercel, OpenFreeMap infrastructure, Climate Clock, met.no, email hosting,
   DNS/CDN providers, and any future service.
7. Create an incident-response and personal-data-breach procedure, with clear
   owners, escalation, evidence preservation, and the applicable 72-hour
   supervisory-authority assessment.
8. Keep a lightweight record of processing activities, data inventory, access
   list, deletion evidence, and change log. Re-run this audit before the Go API,
   account system, saved calculator work, contact forms, or analytics are added.
9. Have the final notice and operating procedures reviewed for the jurisdictions
   actually targeted. Name the relevant supervisory authority and complaint
   route in the notice.

## Public privacy notice acceptance gate

The notice is ready to draft and publish when all of the following are known:

- exact LLP/controller name and full address;
- privacy contact and any legally required representative or DPO details;
- complete purposes, data categories, lawful bases, recipients, and transfers;
- concrete retention periods or defensible criteria;
- the applicable rights and complaint authority;
- operational procedures that can actually honour what the notice promises.

Minimum authoritative references:

- [European Commission: information that must be provided to individuals](https://commission.europa.eu/law/law-topic/data-protection/information-individuals/information-should-be-given-individuals-whose-data-collected_en)
- [European Commission: GDPR processing principles](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/principles-gdpr_en)
- [European Commission: legal grounds for processing](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/legal-grounds-processing-data_en)
- [European Commission: controller and processor roles](https://commission.europa.eu/law/law-topic/data-protection/rules-business-and-organisations/obligations/controllerprocessor/what-data-controller-or-data-processor_en)
- [Vercel Data Processing Addendum](https://vercel.com/legal/dpa)
- [Vercel Web Analytics privacy documentation](https://vercel.com/docs/analytics/privacy-policy)
