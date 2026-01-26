<script lang="ts">
	import { uploadedPdf, appState, extractionResult, swimmerName, selectAllEvents } from '$lib/stores/extraction';
	import { toasts } from '$lib/stores/toast';
	import type { UploadedPdf, ExtractResponse, ExtractErrorResponse } from '$lib/types';

	let isDragOver = $state(false);
	let fileInput = $state<HTMLInputElement | null>(null);
	let errorMessage = $state('');
	let extractionStatus = $state('');
	let pdfUrl = $state('');
	let localSwimmerName = $state('');

	const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
	const API_URL = '/api';

	// Validation functions (defined first for use in derived states)
	const validateFile = (file: File): string | null => {
		if (file.type !== 'application/pdf') {
			return 'Please upload a PDF file';
		}
		if (file.size > MAX_FILE_SIZE) {
			return 'File size must be less than 50MB';
		}
		return null;
	};

	const validateUrl = (url: string): string | null => {
		if (!url.trim()) return null; // Empty is OK (not using URL)
		try {
			const parsed = new URL(url);
			if (!['http:', 'https:'].includes(parsed.protocol)) {
				return 'Only HTTP and HTTPS URLs are supported';
			}
			return null;
		} catch {
			return 'Please enter a valid URL';
		}
	};

	// Validates swimmer name format: "FirstName LastName" or "LastName, FirstName"
	const validateSwimmerName = (name: string): boolean => {
		const trimmed = name.trim();
		if (!trimmed) return false;
		// Pattern 1: FirstName LastName (e.g., "John Smith")
		// Pattern 2: LastName, FirstName (e.g., "Smith, John")
		const firstLastPattern = /^\S+\s+\S+.*$/; // At least two words separated by space
		const lastFirstPattern = /^\S+,\s*\S+.*$/; // Word, comma, optional space, word
		return firstLastPattern.test(trimmed) || lastFirstPattern.test(trimmed);
	};

	// Validation states for real-time feedback
	const swimmerNameValid = $derived(validateSwimmerName(localSwimmerName));
	const urlValid = $derived(pdfUrl.trim().length === 0 || validateUrl(pdfUrl) === null);
	const hasHeatSheet = $derived(pdfUrl.trim().length > 0 || $uploadedPdf !== null);

	// Form is valid when swimmer name is provided and either URL or file is provided
	const isFormValid = $derived(swimmerNameValid && hasHeatSheet && urlValid);

	const handleFile = (file: File) => {
		const error = validateFile(file);
		if (error) {
			errorMessage = error;
			return;
		}

		errorMessage = '';
		const uploaded: UploadedPdf = {
			file,
			name: file.name,
			size: file.size,
			uploadedAt: new Date()
		};
		uploadedPdf.set(uploaded);
	};

	const handleDrop = (event: DragEvent) => {
		event.preventDefault();
		isDragOver = false;

		const file = event.dataTransfer?.files[0];
		if (file) {
			handleFile(file);
		}
	};

	const handleDragOver = (event: DragEvent) => {
		event.preventDefault();
		isDragOver = true;
	};

	const handleDragLeave = () => {
		isDragOver = false;
	};

	const handleFileSelect = (event: Event) => {
		const target = event.target as HTMLInputElement;
		const file = target.files?.[0];
		if (file) {
			handleFile(file);
		}
	};

	const openFilePicker = () => {
		fileInput?.click();
	};

	const formatFileSize = (bytes: number): string => {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	};

	const removeFile = () => {
		uploadedPdf.set(null);
		errorMessage = '';
		extractionStatus = '';
		if (fileInput) {
			fileInput.value = '';
		}
	};

	const pasteFromClipboard = async () => {
		// Try modern clipboard API first (works on desktop browsers and some mobile)
		if (navigator.clipboard?.readText) {
			try {
				const text = await navigator.clipboard.readText();
				if (text.startsWith('http://') || text.startsWith('https://')) {
					pdfUrl = text;
					return;
				} else {
					toasts.warning('Clipboard does not contain a valid URL');
					return;
				}
			} catch {
				// Clipboard API failed (iOS Safari restriction), fall through to manual paste guidance
			}
		}

		// Fallback: Focus URL input and guide user to paste manually
		// iOS Safari allows paste via the native context menu (tap-and-hold on focused input)
		const urlInput = document.getElementById('pdf-url') as HTMLInputElement;
		if (urlInput) {
			urlInput.focus();
			toasts.info('Tap the input field and select "Paste" to paste your URL');
		}
	};

	const startExtraction = async () => {
		// Validate swimmer name
		if (!localSwimmerName.trim()) {
			errorMessage = 'Please enter the swimmer name';
			return;
		}

		// Validate at least one input method
		const pdf = $uploadedPdf;
		const hasUrl = pdfUrl.trim().length > 0;

		if (!pdf && !hasUrl) {
			errorMessage = 'Please provide a PDF file or URL';
			return;
		}

		// Validate URL format if provided
		if (hasUrl && !pdf) {
			const urlError = validateUrl(pdfUrl);
			if (urlError) {
				errorMessage = urlError;
				return;
			}
		}

		// Save swimmer name to store
		swimmerName.set(localSwimmerName.trim());

		appState.set('extracting');
		errorMessage = '';

		try {
			let response: Response;

			// File takes precedence over URL
			if (pdf) {
				extractionStatus = 'Uploading PDF...';
				const formData = new FormData();
				formData.append('pdf', pdf.file);
				formData.append('swimmer', localSwimmerName.trim());

				extractionStatus = 'Processing PDF...';
				response = await fetch(`${API_URL}/extract`, {
					method: 'POST',
					body: formData
				});
			} else {
				extractionStatus = 'Fetching PDF from URL...';
				response = await fetch(`${API_URL}/extractUrl`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json'
					},
					body: JSON.stringify({
						url: pdfUrl.trim(),
						swimmer: localSwimmerName.trim()
					})
				});
			}

			const result = (await response.json()) as ExtractResponse | ExtractErrorResponse;

			if (!result.success) {
				throw new Error(result.error + (result.details ? `: ${result.details}` : ''));
			}

			extractionResult.set(result.data);

			if (result.data.events.length > 0) {
				extractionStatus = `Found ${result.data.events.length} events!`;
				selectAllEvents(result.data.events.length);
				appState.set('search');
			} else {
				toasts.info(`No events found for "${localSwimmerName.trim()}"`);
				extractionStatus = '';
				appState.set('upload');
			}
		} catch (error) {
			console.error('Extraction failed:', error);
			const message = error instanceof Error ? error.message : 'Extraction failed';
			toasts.error(message);
			extractionStatus = '';
			appState.set('upload');
		}
	};
</script>

<div class="space-y-6">
	<!-- Swimmer Name (Required) -->
	<div class="space-y-2">
		<label for="swimmer-name" class="block text-sm font-medium text-sky-800">
			Swimmer <span class="text-red-500">*</span>
		</label>
		<div class="relative">
			<input
				id="swimmer-name"
				type="text"
				bind:value={localSwimmerName}
				placeholder="Enter swimmer's name (e.g., John Smith)"
				disabled={$appState === 'extracting' || $appState === 'search'}
				class="w-full rounded-lg border bg-white px-4 py-3 pr-10 text-sky-900 placeholder-sky-400 transition-colors focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-50
					{swimmerNameValid ? 'border-green-300 focus:border-green-500 focus:ring-green-200' : 'border-sky-200 focus:border-sky-500 focus:ring-sky-200'}"
			/>
			{#if localSwimmerName.length > 0}
				<div class="absolute right-3 top-1/2 -translate-y-1/2">
					{#if swimmerNameValid}
						<svg class="h-5 w-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
						</svg>
					{/if}
				</div>
			{/if}
		</div>
	</div>

	<!-- Heat Sheet (URL or Upload) -->
	<div class="space-y-2">
		<span class="block text-sm font-medium text-sky-800">Heat Sheet <span class="text-red-500">*</span></span>
		<div class="space-y-4 rounded-lg border border-sky-100 bg-sky-50/50 p-4">
			<!-- URL input -->
			<div class="flex flex-col gap-2 sm:flex-row">
				<div class="relative flex-1">
					<input
						id="pdf-url"
						type="url"
						bind:value={pdfUrl}
						placeholder="Enter URL to PDF"
						disabled={$appState === 'extracting' || $appState === 'search'}
						class="w-full rounded-lg border bg-white px-4 py-3 pr-10 text-sky-900 placeholder-sky-400 transition-colors focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-50
							{pdfUrl.trim().length > 0 ? (urlValid ? 'border-green-300 focus:border-green-500 focus:ring-green-200' : 'border-red-300 focus:border-red-500 focus:ring-red-200') : 'border-sky-200 focus:border-sky-500 focus:ring-sky-200'}"
					/>
					{#if pdfUrl.trim().length > 0}
						<div class="absolute right-3 top-1/2 -translate-y-1/2">
							{#if urlValid}
								<svg class="h-5 w-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
								</svg>
							{:else}
								<svg class="h-5 w-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
								</svg>
							{/if}
						</div>
					{/if}
				</div>
				<button
					type="button"
					onclick={pasteFromClipboard}
					disabled={$appState === 'extracting' || $appState === 'search'}
					class="flex items-center justify-center gap-2 rounded-lg border border-sky-200 bg-white px-3 py-3 text-sky-600 transition-colors hover:bg-sky-50 hover:text-sky-700 disabled:cursor-not-allowed disabled:opacity-50 sm:py-0"
					title="Paste from clipboard"
					aria-label="Paste URL from clipboard"
				>
					<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
						/>
					</svg>
					<span class="sm:hidden">Paste URL</span>
				</button>
			</div>

			<!-- Divider -->
			<div class="flex items-center gap-4">
				<div class="h-px flex-1 bg-sky-200"></div>
				<span class="text-base font-medium text-sky-400">OR</span>
				<div class="h-px flex-1 bg-sky-200"></div>
			</div>

			<!-- Upload zone -->
			{#if !$uploadedPdf}
			<button
				type="button"
				class="w-full cursor-pointer rounded-xl border-2 border-dashed p-6 text-center transition-all duration-200
					{isDragOver
					? 'border-sky-500 bg-sky-50'
					: 'border-sky-200 bg-white hover:border-sky-400 hover:bg-sky-50'}
					{$appState === 'extracting' || $appState === 'search' ? 'cursor-not-allowed opacity-50' : ''}"
				ondrop={handleDrop}
				ondragover={handleDragOver}
				ondragleave={handleDragLeave}
				onclick={openFilePicker}
				disabled={$appState === 'extracting' || $appState === 'search'}
			>
				<div class="flex flex-col items-center gap-2">
					<div
						class="flex h-12 w-12 items-center justify-center rounded-full bg-sky-100 text-2xl transition-transform duration-200
						{isDragOver ? 'scale-110' : ''}"
					>
						<span role="img" aria-label="document">📄</span>
					</div>
					<div>
						<p class="text-base text-sky-400">
							{isDragOver ? 'Drop your PDF here' : 'Drag & drop the PDF here, or click to select'}
						</p>
						<p class="mt-1 text-sm text-sky-900">PDF files up to 50MB</p>
					</div>
				</div>
			</button>

			<input
				bind:this={fileInput}
				type="file"
				accept="application/pdf"
				class="hidden"
				onchange={handleFileSelect}
			/>
		{:else}
			<!-- File selected -->
			<div class="rounded-xl border border-sky-200 bg-white p-4">
				<div class="flex items-center justify-between gap-4">
					<div class="flex items-center gap-3">
						<div class="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-100 text-xl">
							<span role="img" aria-label="PDF">📑</span>
						</div>
						<div>
							<p class="font-medium text-sky-900">{$uploadedPdf.name}</p>
							<p class="text-sm text-sky-600">{formatFileSize($uploadedPdf.size)}</p>
						</div>
					</div>
					{#if $appState !== 'extracting' && $appState !== 'search'}
						<button
							type="button"
							onclick={removeFile}
							class="rounded-lg p-2 text-sky-400 transition-colors hover:bg-sky-50 hover:text-sky-600"
							aria-label="Remove file"
						>
							<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M6 18L18 6M6 6l12 12"
								/>
							</svg>
						</button>
					{/if}
				</div>
			</div>
			{/if}
		</div>
	</div>

	<!-- Error message -->
	{#if errorMessage}
		<div class="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
			{errorMessage}
		</div>
	{/if}

	<!-- Submit button -->
	<button
		type="button"
		onclick={startExtraction}
		disabled={!isFormValid || $appState === 'extracting' || $appState === 'search'}
		class="w-full rounded-lg bg-sky-500 px-4 py-3 text-lg font-medium text-white transition-colors hover:bg-sky-600 disabled:cursor-not-allowed disabled:bg-sky-200 disabled:text-sky-400"
	>
		{#if $appState === 'extracting'}
			<span class="flex items-center justify-center gap-2">
				<svg
					class="h-5 w-5 animate-spin"
					xmlns="http://www.w3.org/2000/svg"
					fill="none"
					viewBox="0 0 24 24"
				>
					<circle
						class="opacity-25"
						cx="12"
						cy="12"
						r="10"
						stroke="currentColor"
						stroke-width="4"
					></circle>
					<path
						class="opacity-75"
						fill="currentColor"
						d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
					></path>
				</svg>
				{extractionStatus || 'Processing...'}
			</span>
		{:else if $appState === 'search' && extractionStatus}
			{extractionStatus}
		{:else}
			🔍 Find Events
		{/if}
	</button>
</div>
