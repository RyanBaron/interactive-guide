var gulp         = require('gulp');
var fs           = require("fs");
var runSequence  = require('run-sequence');
var argv         = require('minimist')(process.argv.slice(2));
var changed      = require('gulp-changed');
var merge        = require('merge-stream');
var gulpif       = require('gulp-if');
var lazypipe     = require('lazypipe');
var rev          = require('gulp-rev');
var browserSync  = require('browser-sync').create();
var manifest     = require('asset-builder')('./src/assets/manifest.json');// See https://github.com/austinpray/asset-builder
//html related
var htmlReplace  = require('gulp-html-replace');
//fot related
var flatten      = require('gulp-flatten');
//img related
var imagemin     = require('gulp-imagemin');
//js related
var jshint       = require('gulp-jshint');
var uglify       = require('gulp-uglify');
var concat       = require('gulp-concat');
//css related
var plumber      = require('gulp-plumber');
var less         = require('gulp-less');
var sass         = require('gulp-sass');
var cssNano      = require('gulp-cssnano');
var autoprefixer = require('gulp-autoprefixer');
var sourcemaps   = require('gulp-sourcemaps');

// `path` - Paths to base asset directories. With trailing slashes.
// - `path.source` - Path to the source files. Default: `assets/`
// - `path.dist` - Path to the build directory. Default: `dist/`
var path = manifest.paths;

// `config` - Store arbitrary configuration values here.
var config = manifest.config || {};

// `globs` - These ultimately end up in their respective `gulp.src`.
// - `globs.js` - Array of asset-builder JS dependency objects. Example:
//   {type: 'js', name: 'main.js', globs: []}
// - `globs.css` - Array of asset-builder CSS dependency objects. Example:
//   {type: 'css', name: 'main.css', globs: []}
// - `globs.fonts` - Array of font path globs.
// - `globs.images` - Array of image path globs.
// - `globs.bower` - Array of all the main Bower files.
var globs = manifest.globs;

// `project` - paths to first-party assets.
// - `project.js` - Array of first-party JS assets.
// - `project.css` - Array of first-party CSS assets.
var project = manifest.getProjectGlobs();

// CLI options
var enabled = {
  // Enable static asset revisioning when `--production`
  rev: argv.production,
  // Disable source maps when `--production`
  maps: !argv.production,
  // Fail styles task on error when `--production`
  failStyleTask: argv.production,
  // Fail due to JSHint warnings only when `--production`
  failJSHint: argv.production,
  // Strip debug statments from javascript when `--production`
  stripJSDebug: argv.production
};

// Path to the compiled assets manifest in the dist directory
var revManifest = path.dist + 'assets.json';

// ### Write to rev manifest
// If there are any revved files then write them to the rev manifest.
// See https://github.com/sindresorhus/gulp-rev
var writeToManifest = function(directory) {
  return lazypipe()
    .pipe(gulp.dest, path.dist + directory)
    .pipe(browserSync.stream, {match: '**/*.{js,css}'})
    .pipe(rev.manifest, revManifest, {
    base: path.dist,
    merge: true
  })
    .pipe(gulp.dest, path.dist)();
};

// ### JS processing pipeline
// Example
// ```
// gulp.src(jsFiles)
//   .pipe(jsTasks('main.js')
//   .pipe(gulp.dest(path.dist + 'scripts'))
// ```
var jsTasks = function(filename) {
  return lazypipe()
    .pipe(function() {
    return gulpif(enabled.maps, sourcemaps.init());
  })
    .pipe(concat, filename)
    .pipe(uglify, {
    compress: {
      'drop_debugger': enabled.stripJSDebug
    }
  })
    .pipe(function() {
    return gulpif(enabled.rev, rev());
  })
    .pipe(function() {
    return gulpif(enabled.maps, sourcemaps.write('.', {
      sourceRoot: 'assets/scripts/'
    }));
  })();
};



// ### JSHint
// `gulp jshint` - Lints configuration JSON and project JS.
gulp.task('jshint', function() {
  return gulp.src([
    'bower.json', 'gulpfile.js'
  ].concat(project.js))
    .pipe(jshint())
    .pipe(jshint.reporter('jshint-stylish'))
    .pipe(gulpif(enabled.failJSHint, jshint.reporter('fail')));
});

// ### Scripts
// `gulp scripts` - Runs JSHint then compiles, combines, and optimizes Bower JS
// and project JS.
gulp.task('scripts', ['jshint'], function() {
  var merged = merge();
  manifest.forEachDependency('js', function(dep) {
    merged.add(
      gulp.src(dep.globs, {base: 'scripts'})
      .pipe(jsTasks(dep.name))
    );
  });
  return merged
    .pipe(writeToManifest('scripts'));
});

// ### Fonts
// `gulp fonts` - Grabs all the fonts and outputs them in a flattened directory
// structure. See: https://github.com/armed/gulp-flatten
gulp.task('fonts', function() {
  return gulp.src(globs.fonts)
    .pipe(flatten())
    .pipe(gulp.dest(path.dist + 'fonts'))
    .pipe(browserSync.stream());
});

// ### Images
// `gulp images` - Run lossless compression on all the images.
gulp.task('images', function() {
  return gulp.src(globs.images)
    .pipe(imagemin({
      progressive: true,
      interlaced: true,
      svgoPlugins: [{removeUnknownsAndDefaults: false}, {cleanupIDs: false}]
    }))
    .pipe(gulp.dest(path.dist + 'images'))
    .pipe(browserSync.stream());
});

// ### Wiredep
// `gulp wiredep` - Automatically inject Less and Sass Bower dependencies. See
// https://github.com/taptapship/wiredep
gulp.task('wiredep', function() {
  var wiredep = require('wiredep').stream;
  return gulp.src(project.css)
    .pipe(wiredep())
    .pipe(changed(path.source + 'styles', {
    hasChanged: changed.compareSha1Digest
  }))
    .pipe(gulp.dest(path.source + 'styles'));
});

// ## Reusable Pipelines
// See https://github.com/OverZealous/lazypipe

// ### CSS processing pipeline
// Example
// ```
// gulp.src(cssFiles)
//   .pipe(cssTasks('main.css')
//   .pipe(gulp.dest(path.dist + 'styles'))
// ```
var cssTasks = function(filename) {
  return lazypipe()
    .pipe(function() {
      return gulpif(!enabled.failStyleTask, plumber());
    })
    .pipe(function() {
      return gulpif(enabled.maps, sourcemaps.init());
    })
    .pipe(function() {
      return gulpif('*.less', less());
    })
    .pipe(function() {
      return gulpif('*.scss', sass({
        outputStyle: 'nested', // libsass doesn't support expanded yet
        precision: 10,
        includePaths: ['.'],
        errLogToConsole: !enabled.failStyleTask
      }));
    })
    .pipe(concat, filename)
      .pipe(autoprefixer, {
        browsers: [
          'last 2 versions',
          'android 4',
          'opera 12'
        ]
      })
      .pipe(cssNano, {
        safe: true
      })
      .pipe(function() {
        return gulpif(enabled.rev, rev());
      })
      .pipe(function() {
        return gulpif(enabled.maps, sourcemaps.write('.', {
          sourceRoot: 'assets/styles/'
        }));
      })();
};




// ### Index
// `gulp index` - Generates the dynamic index file
// structure. See: https://www.npmjs.com/package/gulp-html-replace
gulp.task('index', function() {
  var assets = JSON.parse(fs.readFileSync(path.dist + 'assets.json'));
  gulp.src('src/index.html')
    .pipe(htmlReplace({
      'css': assets['main.css'],
      'js': [ assets['jquery.js'],assets['main.js'] ]
  }))
  .pipe(gulp.dest('dist/'));
  /*
  gulp.src('src/index.html')
    .pipe(function() {
      return gulpif(assets['main.css'],
        htmlReplace({
          'css': assets['main.css']
        })
      );
    })
    .pipe(gulp.dest('dist/'));
  */
});


// ### Styles
// `gulp styles` - Compiles, combines, and optimizes Bower CSS and project CSS.
// By default this task will only log a warning if a precompiler error is
// raised. If the `--production` flag is set: this task will fail outright.
gulp.task('styles', ['wiredep'], function() {
  var merged = merge();
  manifest.forEachDependency('css', function(dep) {
    var cssTasksInstance = cssTasks(dep.name);
    if (!enabled.failStyleTask) {
      cssTasksInstance.on('error', function(err) {
        console.error(err.message);
        this.emit('end');
      });
    }
    merged.add(gulp.src(dep.globs, {base: 'styles'})
               .pipe(cssTasksInstance));
  });
  return merged
    .pipe(writeToManifest('styles'));
});



// ### Build
// `gulp build` - Run all the build tasks but don't clean up beforehand.
// Generally you should be running `gulp` instead of `gulp build`.
gulp.task('build', function(callback) {
  runSequence('styles','scripts', ['images', 'fonts'],'index');
});

// ### Clean
// `gulp clean` - Deletes the build folder entirely.
gulp.task('clean', require('del').bind(null, [path.dist]));

// ### Gulp
// `gulp` - Run a complete build. To compile for production run `gulp --production`.
gulp.task('default', ['clean'], function() {
  gulp.start('build');
});
