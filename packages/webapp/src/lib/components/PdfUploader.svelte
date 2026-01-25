<script lang="ts">
	import { uploadedPdf, appState, extractionResult } from '$lib/stores/extraction';
	import type { UploadedPdf, ExtractResponse, ExtractErrorResponse } from '$lib/types';

	let isDragOver = $state(false);
	let fileInput = $state<HTMLInputElement | null>(null);
	let errorMessage = $state('');
	let extractionStatus = $state('');

	const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
	const API_URL = import.meta.env.PUBLIC_API_URL || 'http://localhost:3001';

	const validateFile = (file: File): string | null => {
		if (file.type !== 'application/pdf') {
			return 'Please upload a PDF file';
		}
		if (file.size > MAX_FILE_SIZE) {
			return 'File size must be less than 50MB';
		}
		return null;
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

	const startExtraction = async () => {
		const pdf = $uploadedPdf;
		if (!pdf) return;

		appState.set('extracting');
		errorMessage = '';
		extractionStatus = 'Uploading PDF...';

		try {
			// Create form data with the PDF file
			const formData = new FormData();
			formData.append('pdf', pdf.file);

			extractionStatus = 'Processing PDF pages...';

			// Send to backend
			const response = await fetch(`${API_URL}/extract`, {
				method: 'POST',
				body: formData
			});

			const result = (await response.json()) as ExtractResponse | ExtractErrorResponse;

			if (!result.success) {
				throw new Error(result.error + (result.details ? `: ${result.details}` : ''));
			}

			extractionStatus = `Found ${result.data.events.length} events!`;

			// Store the extraction result
			extractionResult.set(result.data);

			// Transition to search state
			appState.set('search');
		} catch (error) {
			console.error('Extraction failed:', error);
			errorMessage = error instanceof Error ? error.message : 'Extraction failed';
			extractionStatus = '';
			appState.set('upload');
		}
	};
</script>

<div class="space-y-4">
	{#if !$uploadedPdf}
		<!-- Upload zone -->
		<button
			type="button"
			class="w-full cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-all duration-200
				{isDragOver
				? 'border-sky-500 bg-sky-50'
				: 'border-sky-200 bg-white hover:border-sky-400 hover:bg-sky-50'}"
			ondrop={handleDrop}
			ondragover={handleDragOver}
			ondragleave={handleDragLeave}
			onclick={openFilePicker}
		>
			<div class="flex flex-col items-center gap-3">
				<div
					class="flex h-16 w-16 items-center justify-center rounded-full bg-sky-100 text-3xl transition-transform duration-200
					{isDragOver ? 'scale-110' : ''}"
				>
					<span role="img" aria-label="document">📄</span>
				</div>
				<div>
					<p class="text-xl font-medium text-sky-900">
						{isDragOver ? 'Drop your heat sheet here' : 'Upload Heat Sheet PDF'}
					</p>
					<p class="mt-1 text-base text-sky-600">Drag & drop or click to browse</p>
				</div>
				<p class="text-sm text-sky-400">PDF files up to 50MB</p>
			</div>
		</button>

		<input
			bind:this={fileInput}
			type="file"
			accept="application/pdf"
			class="hidden"
			onchange={handleFileSelect}
		/>

		{#if errorMessage}
			<div class="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
				{errorMessage}
			</div>
		{/if}
	{:else}
		<!-- File selected -->
		<div class="rounded-xl border border-sky-200 bg-white p-6">
			<div class="flex items-start justify-between gap-4">
				<div class="flex items-center gap-4">
					<div class="flex h-12 w-12 items-center justify-center rounded-lg bg-sky-100 text-2xl">
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

			{#if errorMessage}
				<div class="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
					{errorMessage}
				</div>
			{/if}

			{#if extractionStatus}
				<div class="mt-4 flex items-center gap-3 text-sky-600">
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

			<div class="mt-6">
				<button
					type="button"
					onclick={startExtraction}
					disabled={$appState === 'extracting'}
					class="w-full rounded-lg bg-sky-500 px-4 py-3 text-lg font-medium text-white transition-colors hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-50"
				>
					{$appState === 'extracting' ? 'Processing...' : 'Find My Events'}
				</button>
			</div>
		</div>
	{/if}
</div>
