<script lang="ts">
  interface FaqItem {
    question: string;
    answer: string;
  }

  const faqs: FaqItem[] = [
    {
      question: 'What is HeatSync?',
      answer:
        "HeatSync is a tool that converts swim meet heat sheets (PDF format) into calendar events. Instead of manually looking up your swimmer's events and adding them to your calendar, HeatSync does it automatically.",
    },
    {
      question: 'How do I use HeatSync?',
      answer:
        "1. Enter the swimmer's name exactly as it appears on the heat sheet.\n2. Either upload a PDF heat sheet or paste a URL to one.\n3. Click 'Find Events' to extract the events.\n4. Select the events you want to add to your calendar.\n5. Download the .ics file and open it with your calendar app.",
    },
    {
      question: 'What PDF formats are supported?',
      answer:
        'HeatSync works best with standard heat sheet PDFs from common swim meet management software like HyTek Meet Manager, Active.com, and SwimTopia. The PDF should contain structured text with event numbers, heat/lane assignments, and swimmer names.',
    },
    {
      question: "Why can't HeatSync find my swimmer?",
      answer:
        "Make sure you enter the swimmer's name exactly as it appears on the heat sheet, including spelling and any suffixes. Try using just the last name if the full name doesn't work. Some PDFs may have formatting issues that prevent proper text extraction.",
    },
    {
      question: "What if an event doesn't have a start time?",
      answer:
        "Some heat sheets don't include specific start times for each event. In this case, HeatSync will skip those events when exporting since calendar events require a start time. The number of skipped events will be shown after export.",
    },
    {
      question: 'What calendar apps work with the .ics file?',
      answer:
        'The .ics format is a universal calendar standard. It works with Apple Calendar, Google Calendar, Microsoft Outlook, and most other calendar applications. Simply open the downloaded file to add the events.',
    },
    {
      question: 'Is my data stored anywhere?',
      answer:
        "Yes. To provide faster results and enable shareable links, HeatSync saves your search results. When you search for a swimmer, the results are stored so that:\n\n• Future searches for the same swimmer in the same PDF load instantly\n• You can share results with others via a link\n\nStored data includes: PDF metadata (not the full PDF), swimmer name, meet information, and the events found. No account or personal contact information is collected.",
    },
    {
      question: 'How do shareable links work?',
      answer:
        "When you find events for a swimmer, HeatSync generates a shareable link (like https://heatsync.now/result/abc123xy). You can copy this link and send it to others—they'll see the same results without needing to upload the PDF again. This is useful for sharing event schedules with family members or coaches.",
    },
    {
      question: "Why am I getting a 'Too many requests' error?",
      answer:
        "To protect the service, there's a limit of 10 requests per minute. If you see this error, wait a minute and try again.",
    },
  ];
</script>

<svelte:head>
  <title>Help & FAQ - HeatSync</title>
</svelte:head>

<div class="pt-8 sm:pt-12">
  <a
    href="/"
    class="inline-flex items-center gap-1 text-sm text-sky-500 hover:text-sky-600 hover:underline"
  >
    <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
    </svg>
    Back to Home
  </a>

  <h1 class="mt-6 text-2xl font-bold text-sky-900 sm:text-3xl">Help & FAQ</h1>
  <p class="mt-2 text-sky-600">Common questions about using HeatSync</p>

  <!-- How to Use Section -->
  <section class="mt-8">
    <h2 class="text-lg font-semibold text-sky-800">Quick Start Guide</h2>
    <div class="mt-4 space-y-4">
      <div class="flex gap-4">
        <div
          class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-sky-100 text-sm font-bold text-sky-600"
        >
          1
        </div>
        <div>
          <p class="font-medium text-sky-900">Enter Swimmer Name</p>
          <p class="text-sm text-sky-600">
            Type the swimmer's name exactly as it appears on the heat sheet
          </p>
        </div>
      </div>
      <div class="flex gap-4">
        <div
          class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-sky-100 text-sm font-bold text-sky-600"
        >
          2
        </div>
        <div>
          <p class="font-medium text-sky-900">Upload or Paste Heat Sheet</p>
          <p class="text-sm text-sky-600">Upload a PDF file or paste a URL to the heat sheet</p>
        </div>
      </div>
      <div class="flex gap-4">
        <div
          class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-sky-100 text-sm font-bold text-sky-600"
        >
          3
        </div>
        <div>
          <p class="font-medium text-sky-900">Select & Export</p>
          <p class="text-sm text-sky-600">
            Choose the events you want and download the calendar file
          </p>
        </div>
      </div>
    </div>
  </section>

  <!-- FAQ Accordion -->
  <section class="mt-10">
    <h2 class="text-lg font-semibold text-sky-800">Frequently Asked Questions</h2>
    <div class="mt-4 space-y-2">
      {#each faqs as faq, index}
        <details class="group rounded-lg border border-sky-100 bg-white">
          <summary
            class="flex cursor-pointer items-center justify-between gap-4 p-4 font-medium text-sky-900 marker:content-none"
          >
            <span>{faq.question}</span>
            <svg
              class="h-5 w-5 flex-shrink-0 text-sky-400 transition-transform group-open:rotate-180"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </summary>
          <div class="border-t border-sky-50 px-4 py-3">
            <p class="text-sm whitespace-pre-line text-sky-600">{faq.answer}</p>
          </div>
        </details>
      {/each}
    </div>
  </section>

  <!-- Troubleshooting Tips -->
  <section class="mt-10">
    <h2 class="text-lg font-semibold text-sky-800">Troubleshooting Tips</h2>
    <ul class="mt-4 space-y-2 text-sm text-sky-600">
      <li class="flex items-start gap-2">
        <span class="text-sky-400">•</span>
        <span>Make sure the PDF is a real heat sheet, not a scanned image</span>
      </li>
      <li class="flex items-start gap-2">
        <span class="text-sky-400">•</span>
        <span>Check the swimmer name spelling matches exactly</span>
      </li>
      <li class="flex items-start gap-2">
        <span class="text-sky-400">•</span>
        <span>Try using last name only if full name doesn't work</span>
      </li>
      <li class="flex items-start gap-2">
        <span class="text-sky-400">•</span>
        <span>For URLs, make sure the link goes directly to the PDF file</span>
      </li>
      <li class="flex items-start gap-2">
        <span class="text-sky-400">•</span>
        <span>If the calendar file doesn't import, try a different calendar app</span>
      </li>
    </ul>
  </section>
</div>
