/**
 * Backend-specific types
 */

/**
 * Configuration for the backend server
 */
export interface ServerConfig {
	port: number;
	openai: {
		apiKey: string;
		baseUrl: string;
		model: string;
	};
}
