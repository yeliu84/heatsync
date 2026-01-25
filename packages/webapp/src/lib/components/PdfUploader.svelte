<script lang="ts">
	import { uploadedPdf, appState } from '$lib/stores/extraction';
	import type { UploadedPdf } from '$lib/types';

	let isDragOver = $state(false);
	let fileInput: HTMLInputElement;
	let errorMessage = $state('');

	const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

	function validateFile(file: File): string | null {
		if (file.type !== 'application/pdf') {
			return 'Please upload a PDF file';
		}
		if (file.size > MAX_FILE_SIZE) {
			return 'File size must be less than 50MB';
		}
		return null;
	}

	function handleFile(file: File) {
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
	}

	function handleDrop(event: DragEvent) {
		event.preventDefault();
		isDragOver = false;

		const file = event.dataTransfer?.files[0];
		if (file) {
			handleFile(file);
		}
	}

	function handleDragOver(event: DragEvent) {
		event.preventDefault();
		isDragOver = true;
	}

	function handleDragLeave() {
		isDragOver = false;
	}

	function handleFileSelect(event: Event) {
		const target = event.target as HTMLInputElement;
		const file = target.files?.[0];
		if (file) {
			handleFile(file);
		}
	}

	function openFilePicker() {
		fileInput?.click();
	}

	function formatFileSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	function removeFile() {
		uploadedPdf.set(null);
		errorMessage = '';
		if (fileInput) {
			fileInput.value = '';
		}
	}

	function startExtraction() {
		appState.set('extracting');
		// Extraction will be implemented in Milestone 2
		// For now, simulate transition to show placeholder
		setTimeout(() => {
			appState.set('search');
		}, 1000);
	}
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
			</div>

			<div class="mt-6">
				<button
					type="button"
					onclick={startExtraction}
					class="w-full rounded-lg bg-sky-500 px-4 py-3 text-lg font-medium text-white transition-colors hover:bg-sky-600"
				>
					Find My Events
				</button>
			</div>
		</div>
	{/if}
</div>
