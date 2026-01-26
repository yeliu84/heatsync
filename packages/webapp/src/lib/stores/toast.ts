import { writable } from 'svelte/store';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
	id: string;
	type: ToastType;
	message: string;
	duration?: number;
}

const createToastStore = () => {
	const { subscribe, update } = writable<Toast[]>([]);

	const addToast = (type: ToastType, message: string, duration = 5000) => {
		const id = crypto.randomUUID();
		const toast: Toast = { id, type, message, duration };

		update((toasts) => [...toasts, toast]);

		if (duration > 0) {
			setTimeout(() => {
				removeToast(id);
			}, duration);
		}

		return id;
	};

	const removeToast = (id: string) => {
		update((toasts) => toasts.filter((t) => t.id !== id));
	};

	return {
		subscribe,
		success: (message: string, duration?: number) => addToast('success', message, duration),
		error: (message: string, duration?: number) => addToast('error', message, duration ?? 8000),
		warning: (message: string, duration?: number) => addToast('warning', message, duration),
		info: (message: string, duration?: number) => addToast('info', message, duration),
		remove: removeToast
	};
};

export const toasts = createToastStore();
