module.exports = {
	globDirectory: 'build/',
	globPatterns: [
		'**/*.{json,ico,html,png,txt,css,js,webmanifest}'
	],
	swDest: 'build/sw.js',
	ignoreURLParametersMatching: [
		/^utm_/,
		/^fbclid$/
	],
	navigateFallback: '/index.html',
	// Monaco is loaded from jsDelivr at runtime; cache it so the editor also works offline.
	runtimeCaching: [
		{
			urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/npm\/monaco-editor@/,
			handler: 'CacheFirst',
			options: {
				cacheName: 'monaco-editor',
				expiration: {
					maxEntries: 40,
					maxAgeSeconds: 60 * 60 * 24 * 365
				},
				cacheableResponse: {
					statuses: [0, 200]
				}
			}
		}
	]
};
