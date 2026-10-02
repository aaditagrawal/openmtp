import MiniCssExtractPlugin from 'mini-css-extract-plugin';

export default function rendererRules(production) {
  const styleLoader = production
    ? { loader: MiniCssExtractPlugin.loader, options: { publicPath: './' } }
    : { loader: 'style-loader' };
  const localIdentName = `${production ? '' : '[path]'}[name]__[local]__[hash:base64:5]`;

  return [
    ...[
      [/\.global\.css$/, false, false],
      [/^((?!\.global).)*\.css$/, false, true],
      [/\.global\.(scss|sass)$/, true, false],
      [/^((?!\.global).)*\.(scss|sass)$/, true, true],
    ].map(([test, sass, modules]) => ({
      test,
      use: [
        styleLoader,
        {
          loader: 'css-loader',
          options: {
            ...(modules ? { modules: { localIdentName } } : {}),
            sourceMap: true,
            ...((production ? sass : modules) ? { importLoaders: 1 } : {}),
          },
        },
        ...(sass
          ? [
              {
                loader: 'sass-loader',
                ...(production ? { options: { sourceMap: true } } : {}),
              },
            ]
          : []),
      ],
    })),
    {
      test: /\.(woff2?|ttf|eot)$/i,
      type: 'asset/resource',
      generator: { filename: 'fonts/[name].[contenthash][ext]' },
    },
    {
      test: /\.(svg|ico|jpe?g|png|gif|webp)$/i,
      type: 'asset/resource',
      generator: { filename: 'images/[name].[contenthash][ext]' },
    },
  ];
}
