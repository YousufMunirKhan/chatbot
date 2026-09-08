import { SETUP_STEPS, type SetupStepKey } from '@/lib/constants';

/**
 * The words the guided setup says, per step.
 *
 * WHAT THIS IS NOT
 * ----------------
 * It is not a second list of steps. The steps, their order, their titles and
 * whether each one is finished all come from `getCompanySetupProgress()` in
 * `src/modules/company/setup-data.ts`, which is the source of truth and is not
 * touched by any of this. This file only adds what a checklist row has no room
 * for and a guided screen needs:
 *
 *  - `question` — the single decision the screen is asking, in the second
 *    person, because a screen that asks one thing is the whole point of a
 *    wizard;
 *  - `why` — what the customer gets out of doing it, once, in a sentence;
 *  - `cta` — the click, in the owner's voice;
 *  - `skipCost` — what they lose by skipping. A step nobody may skip is a step
 *    people abandon the product at, but a skip offered with no consequence
 *    stated is a trap. Both are written down.
 *  - `minutes` — a rough honest estimate. "How long will this take?" is the
 *    question that decides whether somebody starts now or closes the tab.
 *
 * Plain module, not `'use client'`: a client module exporting a plain object
 * into a server component compiles, passes tsc, and renders a blank page.
 */

export interface GuideStepCopy {
  question: string;
  why: string;
  cta: string;
  skipCost: string;
  minutes: string;
}

export const GUIDE_COPY: Record<SetupStepKey, GuideStepCopy> = {
  purpose: {
    question: 'Who should your assistant talk to?',
    why: 'Everything after this follows from the answer — the jobs it can do, the facts it asks you for, and where it ends up living.',
    cta: 'Create my assistant',
    skipCost:
      'Nothing else works until one exists, so you will be back here. Skip only if someone else on your team is making it.',
    minutes: 'about 2 minutes',
  },
  capabilities: {
    question: 'What do you want it doing for you?',
    why: 'Tick only what you want it doing today. Anything you leave off can be turned on later, and nothing is lost.',
    cta: 'Pick the jobs',
    skipCost:
      'It will answer general questions and nothing more — no bookings, no enquiries, no order tracking.',
    minutes: 'about 1 minute',
  },
  'required-data': {
    question: 'What does it need to know about your business?',
    why: 'This is the part that decides whether the answers are any good. Give it your website and it reads the pages itself.',
    cta: 'Add my details',
    skipCost:
      'It will keep saying it does not know. That is safer than guessing, but it is not much use to a customer.',
    minutes: '5 to 10 minutes',
  },
  test: {
    question: 'Does it actually answer well?',
    why: 'Ask it what your customers ask — including one thing it cannot possibly know, to check it says so rather than making something up.',
    cta: 'Try it now',
    skipCost:
      'The first person to find out whether it answers well will be a customer, on your website.',
    minutes: 'about 3 minutes',
  },
  install: {
    question: 'Where should customers find it?',
    why: 'One line of code on your site and the chat appears in the corner of every page you put it on.',
    cta: 'Get my website code',
    skipCost:
      'Everything you have set up stays saved and stays private. Nobody can talk to it until this is done.',
    minutes: 'about 2 minutes',
  },
};

/** The step order, taken from the constants the checklist already renders. */
export const GUIDE_STEP_KEYS = SETUP_STEPS.map((step) => step.key);

/** `done` is the finish screen, not a sixth step — it is never in the count. */
export const GUIDE_DONE = 'done' as const;

export type GuideScreen = SetupStepKey | typeof GUIDE_DONE;

/** Every screen the guide will render, so an unknown `?step=` can be rejected. */
export function isGuideScreen(value: string | undefined): value is GuideScreen {
  return value === GUIDE_DONE || GUIDE_STEP_KEYS.includes(value as SetupStepKey);
}

/** `/company/setup/guide?step=test`. One place, so no link can misspell it. */
export function guideHref(screen: GuideScreen): string {
  return `/company/setup/guide?step=${screen}`;
}
