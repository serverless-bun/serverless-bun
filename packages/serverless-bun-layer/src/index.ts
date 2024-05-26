import { readFileSync, writeFileSync } from 'node:fs'

import Ajv, { type JSONSchemaType } from 'ajv'
import JSZip from 'jszip'
import pascalCase from 'just-pascal-case'
import type * as Serverless from 'serverless'
import type * as Plugin from 'serverless/classes/Plugin'
import type * as Service from 'serverless/classes/Service'

type ServerlessCustomProperties = {
  bunLayer?: {
    arch?: 'x64' | 'aarch64'
    release?: 'latest' | 'canary' | string
    url?: string
    output?: string
    public?: boolean
    layerKey?: string
    omitInjection?: boolean
  }
}

const customPropertiesSchema: JSONSchemaType<ServerlessCustomProperties> = {
  type: 'object',
  properties: {
    bunLayer: {
      type: 'object',
      additionalProperties: false,
      nullable: true,
      properties: {
        arch: {
          type: 'string',
          enum: ['aarch64', 'x64'],
          nullable: true,
          default: 'aarch64',
        },
        release: {
          type: 'string',
          nullable: true,
          default: 'latest',
        },
        url: {
          type: 'string',
          nullable: true,
        },
        output: {
          type: 'string',
          nullable: true,
          default: './bun-lambda-layer.zip',
        },
        public: {
          type: 'boolean',
          nullable: true,
          default: false,
        },
        layerKey: {
          type: 'string',
          nullable: true,
          default: 'bun',
        },
        omitInjection: {
          type: 'boolean',
          nullable: true,
          default: false,
        },
      },
      default: {
        arch: 'aarch64',
        release: 'latest',
        url: undefined,
        output: './bun-lambda-layer.zip',
        layer: 'bun',
        public: false,
        omitInjection: false,
      },
    },
  },
} as const

interface ServerlessFunctionProperties {
  omitBunLayer?: boolean
}

const functionPropertiesSchema: JSONSchemaType<ServerlessFunctionProperties> = {
  type: 'object',
  properties: {
    omitBunLayer: {
      type: 'boolean',
      nullable: true,
      default: false,
    },
  },
} as const

type ServerlessOptions = Serverless.Options &
  Required<
    Pick<NonNullable<ServerlessCustomProperties['bunLayer']>, 'arch' | 'release' | 'url' | 'output'>
  >

type ServerlessFunction = ServerlessFunctionProperties &
  (Serverless.FunctionDefinitionHandler | Serverless.FunctionDefinitionImage) & {
    architecture?: string
    layers?: Service['provider']['layers']
  }

type ServerlessPluginCommand = Record<
  string,
  NonNullable<NonNullable<Plugin.Commands[string]['commands']>[string]['options']>[string] & {
    default?: string
  }
>

type ServerlessProvider = Service['provider'] & { architecture?: string }

const ETAG_FILE = '.etag.txt'

export default class BunLayerPlugin implements Plugin {
  serverless: Serverless
  provider: ReturnType<typeof this.serverless.getProvider>
  hooks: Plugin.Hooks
  commands?: Plugin.Commands | undefined
  options: ServerlessOptions
  logging: Plugin.Logging

  constructor(serverless: Serverless, options: Serverless.Options, logging: Plugin.Logging) {
    serverless.configSchemaHandler.defineCustomProperties(customPropertiesSchema)
    serverless.configSchemaHandler.defineFunctionProperties('aws', functionPropertiesSchema)

    this.serverless = serverless
    this.provider = serverless.getProvider('aws')
    this.options = options as ServerlessOptions
    this.logging = logging
    this.commands = {
      bun: {
        commands: {
          'build-layer': {
            usage: 'Build Bun runtime layer',
            lifecycleEvents: ['run'],
            options: {
              arch: {
                usage: 'The architecture type to support. Defaults to "aarch64"',
                shortcut: 'a',
                default: 'aarch64',
                type: 'string',
              },
              release: {
                usage: 'The release of Bun to install. Defaults to "latest"',
                shortcut: 'r',
                default: 'latest',
                type: 'string',
              },
              url: {
                usage: 'A custom URL to download Bun',
                shortcut: 'u',
                type: 'string',
              },
              output: {
                usage: 'The output file for the Bun. Defaults to "./bun-lambda-layer.zip',
                shortcut: 'o',
                default: './bun-lambda-layer.zip',
                type: 'string',
              },
            } as ServerlessPluginCommand,
          },
        },
      },
    }
    this.hooks = {
      initialize: () => {
        this.initBunLayerConfig()
      },
      'before:package:createDeploymentArtifacts': async () => {
        await this.buildLambdaLayer(
          this.bunLayerConfig.release,
          this.bunLayerConfig.arch,
          this.bunLayerConfig.url,
          this.bunLayerConfig.output
        )
      },
      'before:package:compileLayers': () => {
        if (this.bunLayerConfig.omitInjection) {
          return
        }

        this.injectLambdaLayer(
          this.bunLayerConfig.arch,
          this.bunLayerConfig.output,
          this.bunLayerConfig.layerKey,
          this.bunLayerConfig.public
        )
      },
      'bun:build-layer:run': async () => {
        await this.buildLambdaLayer(
          this.options.release,
          this.options.arch,
          this.options.url,
          this.options.output
        )
      },
    }
  }

  private initBunLayerConfig() {
    this.serverless.service.custom ??= {}
    new Ajv({
      removeAdditional: true,
      useDefaults: true,
    }).compile(customPropertiesSchema)(this.serverless.service.custom)
  }

  private get bunLayerConfig() {
    return this.serverless.service.custom.bunLayer as NonNullable<
      ServerlessCustomProperties['bunLayer']
    >
  }

  private async extractETag(output = './bun-lambda-layer.zip') {
    try {
      const content = readFileSync(output)
      const archive = await JSZip.loadAsync(content)
      const etag = await archive.file(ETAG_FILE)?.async('string')
      return etag
    } catch (err) {
      if (err instanceof Error && 'code' in err && err.code !== 'ENOENT') {
        throw err
      }
    }
  }

  // Based on https://github.com/oven-sh/bun/blob/main/packages/bun-lambda/scripts/build-layer.ts
  async buildLambdaLayer(
    release = 'latest',
    arch = 'aarch64',
    url?: string,
    output = './bun-lambda-layer.zip'
  ) {
    const progress = this.logging.progress.create({
      message: 'Compiling Bun runtime layer',
    })

    let oldETag: Awaited<ReturnType<typeof this.extractETag>>
    try {
      oldETag = await this.extractETag(output)
    } catch (cause) {
      throw new Error(`Failed to read ETag from ${output}: ${cause}`)
    }

    if (oldETag) {
      this.logging.log.info('Extracted ETag %s from existing runtime layer at %s', oldETag, output)
    }

    const { href } = new URL(url ?? `https://bun.sh/download/${release}/linux/${arch}?avx2=true`)

    this.logging.log.info('Downloading Bun from %s', href)

    const response = await fetch(href, {
      headers: {
        'User-Agent': 'serverless-bun-layer',
        ...(oldETag && { 'If-None-Match': oldETag }),
      },
    })

    if (response.url !== href) {
      this.logging.log.debug('Redirected URL: %s', response.url)
    }

    this.logging.log.debug('Response: %s %s', response.status, response.statusText)

    if (response.status === 304) {
      this.logging.log.success('Bun runtime layer already exists at %s', output)
      progress.remove()
      return
    }

    if (!response.ok) {
      const reason = await response.text()
      throw new Error(reason)
    }

    const newETag = response.headers.get('ETag')!

    if (oldETag) {
      this.logging.log.info(
        "Recompiling runtime layer, server response's ETag %s differs with existing ETag %s",
        newETag,
        oldETag
      )
    }

    this.logging.log.info('Downloaded Bun from %s', href)

    this.logging.log.info('Extracting Bun')

    const buffer = await response.arrayBuffer()

    let archive: Awaited<ReturnType<typeof JSZip.loadAsync>>
    try {
      archive = await JSZip.loadAsync(buffer)
    } catch (cause) {
      throw new Error(`Failed to unzip file: ${cause}`)
    }

    this.logging.log.debug('Extracted archive: %s', Object.keys(archive.files))

    const bun = archive.filter((_, { dir, name }) => !dir && name.endsWith('bun'))[0]
    if (!bun) {
      throw new Error('Failed to find executable in zip')
    }

    const cwd = bun.name.split('/')[0]
    archive = archive.folder(cwd) ?? archive
    for (const filename of ['bootstrap', 'runtime.ts']) {
      const url = `https://raw.githubusercontent.com/oven-sh/bun/main/packages/bun-lambda/${filename}`

      this.logging.log.info('Downloading %s from %s', filename, url)

      const response = await fetch(url)

      this.logging.log.debug('Response: %s %s', response.status, response.statusText)

      if (!response.ok) {
        const reason = await response.text()
        throw new Error(`Failed to fetch ${filename} from GitHub: ${reason}`)
      }

      this.logging.log.info('Downloaded %s from %s', filename, url)

      const content = await response.text()
      archive.file(filename, content)
    }

    archive.file(ETAG_FILE, newETag)

    this.logging.log.info('Added ETag %s (%s) to archive', ETAG_FILE, newETag)

    this.logging.log.info('Saving Bun runtime layer to %s', output)

    try {
      const archiveBuffer = await archive.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: {
          level: 9,
        },
      })

      writeFileSync(output, archiveBuffer)
    } catch (cause) {
      throw new Error(`Failed to generate Bun lambda layer: ${cause}`)
    }

    this.logging.log.info('Saved Bun runtime layer to %s', output)

    this.logging.log.success('Compiled Bun runtime layer to %s', output)

    progress.remove()
  }

  // Based on https://github.com/oven-sh/bun/blob/main/packages/bun-lambda/scripts/publish-layer.ts
  injectLambdaLayer(
    arch = 'aarch64',
    output = './bun-lambda-layer.zip',
    layerKey = 'bun',
    isPublic = false
  ) {
    this.logging.log.info('Injecting Bun runtime layer')

    const compatibleRuntimes = ['provided.al2', 'provided']
    const compatibleArchitectures = [arch === 'x64' ? 'x86_64' : 'arm64']

    this.serverless.service.layers = {
      ...this.serverless.service.layers,
      [layerKey]: {
        package: {
          artifact: output,
        },
        name: `${this.serverless.service.getServiceName()}-${layerKey}`,
        description:
          'Bun is an incredibly fast JavaScript runtime, bundler, transpiler, and package manager.',
        compatibleRuntimes,
        compatibleArchitectures,
        licenseInfo: 'MIT',
        allowedAccounts: isPublic ? ['*'] : undefined,
      },
    }

    this.serverless.service
      .getAllFunctions()
      .map((name) => this.serverless.service.getFunction(name))
      .filter((func: ServerlessFunction) => {
        if (func.omitBunLayer) {
          return false
        }

        const runtime = func.runtime ?? this.serverless.service.provider.runtime
        const architecture =
          func.architecture ?? (this.serverless.service.provider as ServerlessProvider).architecture

        if (!runtime || !architecture) {
          return false
        }

        const isRuntimeCompatible = compatibleRuntimes.includes(runtime)
        const isArchitecturesCompatible = compatibleArchitectures.includes(architecture)

        return isRuntimeCompatible && isArchitecturesCompatible
      })
      .forEach((func: ServerlessFunction) => {
        // https://www.serverless.com/framework/docs/providers/aws/guide/layers#using-your-layers
        func.layers = [
          ...(func.layers ?? []),
          {
            Ref: `${pascalCase(layerKey)}LambdaLayer`,
          },
        ]
      })

    this.logging.log.info('Injected Bun runtime layer')
  }
}
