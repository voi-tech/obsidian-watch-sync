declare module 'stremio-watched-bitfield' {
	class WatchedBitField {
		videoIds: string[];
		get(index: number): boolean;
		set(index: number, value: boolean): void;
		getVideo(videoId: string): boolean;
		setVideo(videoId: string, value: boolean): void;
		serialize(): string;
	}

	namespace WatchedBitField {
		/**
		 * Rebuilds a bitfield from its serialized form, shifting it when the video
		 * list grew since serialization. Throws on malformed input.
		 */
		function constructAndResize(serialized: string, videoIds: string[]): WatchedBitField;
		function constructFromArray(values: (0 | 1 | boolean)[], videoIds: string[]): WatchedBitField;
	}

	export = WatchedBitField;
}
