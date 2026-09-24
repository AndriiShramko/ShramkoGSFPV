import resolve from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';

export default {
    input: 'probe/entry.ts',
    output: {
        file: 'probe/gsfpv.js',
        format: 'es',
        sourcemap: false
    },
    external: ['playcanvas'],
    plugins: [
        resolve(),
        typescript({
            tsconfig: false,
            target: 'es2022',
            module: 'esnext',
            moduleResolution: 'bundler',
            strict: false,
            skipLibCheck: true,
            include: ['probe/**/*.ts', 'src/**/*.ts']
        })
    ]
};
