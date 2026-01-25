<script lang="ts">
	import { uploadedPdf, appState, extractionResult, swimmerName } from '$lib/stores/extraction';
	import type { UploadedPdf, ExtractResponse, ExtractErrorResponse } from '$lib/types';

	let isDragOver = $state(false);
	let fileInput = $state<HTMLInputElement | null>(null);
	let errorMessage = $state('');
	let extractionStatus = $state('');
	let pdfUrl = $state('');
	let localSwimmerName = $state('');

	const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
	const API_URL = import.meta.env.PUBLIC_API_URL || 'http://localhost:3001';

	// Form is valid when swimmer name is provided and either URL or file is provided
	const isFormValid = $derived(
		localSwimmerName.trim().length > 0 && (pdfUrl.trim().length > 0 || $uploadedPdf !== null)
	);

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
		try {
			const text = await navigator.clipboard.readText();
			if (text.startsWith('http://') || text.startsWith('https://')) {
				pdfUrl = text;
				errorMessage = '';
			} else {
				errorMessage = 'Clipboard does not contain a valid URL';
			}
		} catch {
			// Clipboard access denied - fail silently or show subtle feedback
			errorMessage = 'Could not access clipboard';
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

			extractionStatus = `Found ${result.data.events.length} events!`;
			extractionResult.set(result.data);
			appState.set('search');
		} catch (error) {
			console.error('Extraction failed:', error);
			errorMessage = error instanceof Error ? error.message : 'Extraction failed';
			extractionStatus = '';
			appState.set('upload');
		}
	};
</script>

<div class="space-y-6">
	<!-- Section 1: Swimmer Name (Required) -->
	<div class="space-y-2">
		<label for="swimmer-name" class="block text-sm font-medium text-sky-800">
			1. Swimmer Name <span class="text-red-500">*</span>
		</label>
		<input
			id="swimmer-name"
			type="text"
			bind:value={localSwimmerName}
			placeholder="Enter swimmer's name (e.g., John Smith)"
			disabled={$appState === 'extracting'}
			class="w-full rounded-lg border border-sky-200 bg-white px-4 py-3 text-sky-900 placeholder-sky-400 transition-colors focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200 disabled:cursor-not-allowed disabled:opacity-50"
		/>
	</div>

	<!-- Section 2: Heat Sheet URL -->
	<div class="space-y-2">
		<label for="pdf-url" class="block text-sm font-medium text-sky-800"> 2. Heat Sheet URL </label>
		<div class="relative flex gap-2">
			<input
				id="pdf-url"
				type="url"
				bind:value={pdfUrl}
				placeholder="https://example.com/heatsheet.pdf"
				disabled={$appState === 'extracting'}
				class="flex-1 rounded-lg border border-sky-200 bg-white px-4 py-3 text-sky-900 placeholder-sky-400 transition-colors focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200 disabled:cursor-not-allowed disabled:opacity-50"
			/>
			<button
				type="button"
				onclick={pasteFromClipboard}
				disabled={$appState === 'extracting'}
				class="flex items-center justify-center rounded-lg border border-sky-200 bg-white px-3 text-sky-600 transition-colors hover:bg-sky-50 hover:text-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
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
			</button>
		</div>
	</div>

	<!-- Divider -->
	<div class="flex items-center gap-4">
		<div class="h-px flex-1 bg-sky-200"></div>
		<span class="text-sm text-sky-400">or</span>
		<div class="h-px flex-1 bg-sky-200"></div>
	</div>

	<!-- Section 3: Upload PDF -->
	<div class="space-y-2">
		<span class="block text-sm font-medium text-sky-800"> 3. Upload PDF </span>

		{#if !$uploadedPdf}
			<!-- Upload zone -->
			<button
				type="button"
				class="w-full cursor-pointer rounded-xl border-2 border-dashed p-6 text-center transition-all duration-200
					{isDragOver
					? 'border-sky-500 bg-sky-50'
					: 'border-sky-200 bg-white hover:border-sky-400 hover:bg-sky-50'}
					{$appState === 'extracting' ? 'cursor-not-allowed opacity-50' : ''}"
				ondrop={handleDrop}
				ondragover={handleDragOver}
				ondragleave={handleDragLeave}
				onclick={openFilePicker}
				disabled={$appState === 'extracting'}
			>
				<div class="flex flex-col items-center gap-2">
					<div
						class="flex h-12 w-12 items-center justify-center rounded-full bg-sky-100 text-2xl transition-transform duration-200
						{isDragOver ? 'scale-110' : ''}"
					>
						<span role="img" aria-label="document">📄</span>
					</div>
					<div>
						<p class="text-base font-medium text-sky-900">
							{isDragOver ? 'Drop your heat sheet here' : 'Drag & drop or click'}
						</p>
						<p class="mt-1 text-sm text-sky-500">PDF files up to 50MB</p>
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
					{#if $appState !== 'extracting'}
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

	<!-- Error message -->
	{#if errorMessage}
		<div class="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
			{errorMessage}
		</div>
	{/if}

	<!-- Extraction status -->
	{#if extractionStatus}
		<div class="flex items-center gap-3 text-sky-600">
			{#if $appState === 'extracting'}
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
			{/if}
			<span>{extractionStatus}</span>
		</div>
	{/if}

	<!-- Submit button -->
	<button
		type="button"
		onclick={startExtraction}
		disabled={!isFormValid || $appState === 'extracting'}
		class="w-full rounded-lg bg-sky-500 px-4 py-3 text-lg font-medium text-white transition-colors hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-50"
	>
		{#if $appState === 'extracting'}
			Processing...
		{:else}
			🔍 Find My Events
		{/if}
	</button>
</div>
