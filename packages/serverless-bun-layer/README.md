# Serverless Bun Layer

A zero-config [Serverless Framework](https://www.serverless.com/) plugin to automate the management of [AWS Bun Lambda Layer](https://github.com/oven-sh/bun/tree/main/packages/bun-lambda).

## Getting Started

Install the plugin with your favorite package manager:

```bash
npm install @serverless-bun/layer -D # or 'bun add @serverless-bun/layer -D'
```

Then add the plugin to your `serverless.yml` file:

```yml
plugins:
  - '@serverless-bun/layer'
```

Ensure that the function's `architecture` and `runtime` are compatible with the Bun Layer:

```yml
custom:
  bunLayer:
    release: 1.0.25 # This is not required, however for most cases, you should specify a version here. Defaults to "latest" if unspecified.

provider:
  name: aws
  architecture: arm64 # Set to "x86_64" if arch is set to "x64".
  runtime: provided.al2 # Or "provided".

# Or at function-level:

functions:
  myFunction:
    architecture: arm64
    runtime: provided.al2
```

That's it! (Build and) Deploy your application with Serverless Framework:

```bash
sls deploy
```

## Configuration

The plugin works out of the box by default; however, configurations are supported.

### Custom Properties

Configure the plugin by adding the `bunLayer` property in the custom section of your `serverless.yml` file.

```yml
custom:
  bunLayer:
    arch: aarch64 # Architecture type to support. (options: 'aarch64', 'x64'; default: 'aarch64')
    release: latest # Release of Bun to install. (default: 'latest')
    url: <custom-url> # Custom URL to download Bun. (optional)
    output: ./bun-lambda-layer.zip # Output file for the Bun. (default: './bun-lambda-layer.zip')
    public: false # Allow access to the Lambda Layer from any AWS account. (default: false)
    layerKey: bun # Key of the Lambda Layer that will be injected to the layers property. (default: 'bun')
    omitInjection: false # Omit injecting the Lambda Layer into the serverless config, useful when you want to use this plugin for downloading and compiling Bun Lambda Layer only. (default: false)
```

### Function Properties

You can specify function-level properties to control the behavior of the plugin for individual functions.

```yml
functions:
  myFunction:
    omitBunLayer: true # Omit Bun Layer for this specific function.
```

## How it works?

The Serverless Bun Layer plugin simplifies the integration of the [AWS Bun Lambda Layer](https://github.com/oven-sh/bun/tree/main/packages/bun-lambda) into your [Serverless Framework](https://www.serverless.com/) project. During the packaging phase, the plugin automatically downloads and compiles the required Bun runtime layer based on the provided configuration. This seamless process ensures that your AWS Lambda functions have access to the Bun runtime layer without manual intervention.

The compiled Lambda Layer is then intelligently injected into your `serverless.yml` configuration, providing a smooth and hassle-free experience. The plugin identifies functions compatible with the Bun Lambda Layer, automatically including the layer in their configurations. With the Serverless Bun Layer plugin, deploying your Bun-powered Serverless applications becomes a straightforward process, handling the complexities of Lambda Layer integration seamlessly behind the scenes.

## CloudFormation Variable

Serverless Framework is powered by [AWS Cloudformation](https://aws.amazon.com/cloudformation/) under the hood. Serverless Bun Layer plugin injects Bun Lambda Layer into your Cloudformation template. For advanced use cases, you can utilize this reference in your Serverless Framework configuration as follows:

```yml
custom:
  bunLayer:
    layerKey: my-bun

resources:
  Outputs:
    MyBunLambdaLayerARN:
      # https://www.serverless.com/framework/docs/providers/aws/guide/layers#using-your-layers
      # https://www.serverless.com/framework/docs/providers/aws/guide/resources#override-aws-cloudformation-resource
      Value: !Ref MyDashbunLambdaLayer # "my-bun" becomes "MyDashbun" + "LambdaLayer"
      Export:
        Name: !Sub ${AWS::StackName}-my-bun-lambda-layer
```

## Commands

### `sls bun build-layer`

Builds a Lambda layer for Bun and saves it to a `.zip` file.

_This is an alias command for the [`build-layer`](https://github.com/oven-sh/bun/tree/main/packages/bun-lambda#bun-run-build-layer) script using Serverless._

## Examples

For more examples and customization options, refer to the [examples](../../examples/) directory in this repository.

## License

[MIT](../../LICENSE)
