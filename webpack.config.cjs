// webpack.config.cjs
// Multi-build configuration for WTR Lab Retranslate

const path = require("node:path")
const { UserscriptPlugin } = require("webpack-userscript")

const {
	PACKAGE_NAME,
	getDevHeaders,
	getGreasyForkHeaders,
	getPerformanceHeaders,
} = require("./userscript.metadata.cjs")

const typeScriptRule = () => ({
	test: /\.ts$/,
	use: {
		loader: "ts-loader",
		options: {
			transpileOnly: true,
			compilerOptions: { noEmit: false },
		},
	},
	exclude: /node_modules/,
})

// 1. Performance Build (Production)
const performanceConfig = {
	name: "performance",
	mode: "production",
	target: "web",
	entry: "./src/index.ts",
	output: {
		path: path.resolve(__dirname, "dist"),
		filename: `${PACKAGE_NAME}.user.js`,
	},
	resolve: {
		extensions: [".ts", ".js"],
	},
	module: {
		rules: [typeScriptRule()],
	},
	optimization: {
		minimize: true,
		usedExports: true,
		concatenateModules: true,
		splitChunks: {
			chunks: "all",
		},
	},
	plugins: [
		new UserscriptPlugin({
			headers: getPerformanceHeaders(),
		}),
	],
}

// 2. GreasyFork Build
const greasyforkConfig = {
	name: "greasyfork",
	mode: "production",
	target: "web",
	entry: "./src/index.ts",
	output: {
		path: path.resolve(__dirname, "dist"),
		filename: `${PACKAGE_NAME}.greasyfork.user.js`,
	},
	resolve: {
		extensions: [".ts", ".js"],
	},
	module: {
		rules: [typeScriptRule()],
	},
	optimization: {
		minimize: false,
		usedExports: true,
		concatenateModules: true,
	},
	plugins: [
		new UserscriptPlugin({
			headers: getGreasyForkHeaders(),
		}),
	],
}

// 3. Development Build
const devConfig = {
	name: "dev",
	mode: "development",
	target: "web",
	entry: "./src/index.ts",
	output: {
		path: path.resolve(__dirname, "dist"),
		filename: `${PACKAGE_NAME}.dev.user.js`,
		publicPath: "http://localhost:8080/",
	},
	devServer: {
		static: {
			directory: path.join(__dirname, "dist"),
		},
		port: 8080,
		hot: true,
		liveReload: false,
		client: {
			webSocketURL: "ws://localhost:8080/ws",
			overlay: false,
			logging: "none",
		},
	},
	resolve: {
		extensions: [".ts", ".js"],
	},
	module: {
		rules: [typeScriptRule()],
	},
	optimization: {
		minimize: false,
		usedExports: true,
		splitChunks: {
			chunks: "all",
		},
	},
	plugins: [
		new UserscriptPlugin({
			headers: getDevHeaders(),
			proxyScript: {
				baseURL: "http://localhost:8080/",
				filename: "[basename].proxy.user.js",
			},
		}),
	],
}

module.exports = [performanceConfig, greasyforkConfig, devConfig]
