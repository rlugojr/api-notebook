/* global describe, it */

describe('Code Cell', function () {
  var Code    = App.View.CodeCell;
  var fixture = document.getElementById('fixture');

  it('should exist', function () {
    expect(Code).to.be.a('function');
  });

  describe('Code Cell instance', function () {
    var view;

    beforeEach(function () {
      view = new Code();
    });

    it('should have a class', function () {
      expect(view.el.className).to.contain('cell');
      expect(view.el.className).to.contain('cell-code');
    });

    describe('#render', function () {
      beforeEach(function () {
        view = view.render();
      });

      it('should append a result view', function () {
        expect(view.result).to.be.an.instanceof(App.View.ResultCell);
      });
    });

    describe('Using the editor', function () {
      var editor;

      beforeEach(function () {
        view   = view.render().appendTo(fixture);
        editor = view.editor;
        // Need to set certain properties for testing
        view.model.view = view;
        view.sandbox    = new App.Sandbox();
        (new App.Collection.Notebook()).add(view.model);
      });

      afterEach(function () {
        view.remove();
      });

      it('should be a javascript editor', function () {
        expect(editor.getOption('mode')).to.equal('javascript');
      });

      describe('keyboard shortcuts', function () {
        var UP    = 38;
        var DOWN  = 40;
        var ENTER = 13;

        it('Execute Code (`Enter`)', function () {
          var spy = sinon.spy();
          view.on('execute', spy);
          fakeKey(editor, ENTER);
          expect(spy.calledOnce).to.be.ok;
        });

        it('New Line (`Shift-Enter`)', function () {
          expect(editor.getValue()).to.equal('');
          fakeKey(editor, ENTER, { shiftKey: true });
          expect(editor.getValue()).to.equal('\n');
          fakeKey(editor, ENTER, { shiftKey: true });
          expect(editor.getValue()).to.equal('\n\n');
        });

        it('Browse Code Up (`Up`)', function () {
          var spy = sinon.spy();
          view.on('browseUp', spy);
          editor.setValue('more\nthan\none\nline');
          editor.setCursor({ line: 2, char: 0 });
          fakeKey(editor, UP);
          expect(spy.calledOnce).to.not.be.ok;
          expect(editor.getCursor().line).to.equal(1);
          fakeKey(editor, UP);
          expect(spy.calledOnce).to.not.be.ok;
          expect(editor.getCursor().line).to.equal(0);
          fakeKey(editor, UP);
          expect(spy.calledOnce).to.be.ok;
        });

        it('Browse Code Down (`Down`)', function () {
          var spy = sinon.spy();
          view.on('browseDown', spy);
          editor.setValue('more\nthan\none\nline');
          editor.setCursor({ line: 1, char: 0 });
          fakeKey(editor, DOWN);
          expect(spy.calledOnce).to.not.be.ok;
          expect(editor.getCursor().line).to.equal(2);
          fakeKey(editor, DOWN);
          expect(spy.calledOnce).to.not.be.ok;
          expect(editor.getCursor().line).to.equal(3);
          fakeKey(editor, DOWN);
          expect(spy.calledOnce).to.be.ok;
        });
      });

      describe('execute code', function () {
        beforeEach(function () {
          // Need to set a collection for the test to work properly
          var collection = new App.Collection.Notebook();
          view.model.view = view;
          view.sandbox    = new App.Sandbox();
          view.model.collection = {
            serializeForEval: sinon.stub().returns({})
          };
        });

        it('should render the result', function () {
          var spy  = sinon.spy(view.result, 'setResult');
          var code = '10';

          view.on('execute', function (view, err, result) {
            expect(result).to.equal(10);
          });

          editor.setValue(code);
          view.execute();
          expect(spy.calledOnce).to.be.ok;
          expect(view.model.get('value')).to.equal(code);
          expect(view.model.get('result')).to.equal(10);
        });

        it('should render an error', function () {
          var spy  = sinon.spy(view.result, 'setError');
          var code = 'throw new Error(\'Testing\');';

          view.on('execute', function (view, err, result) {
            expect(err.message).to.equal('Testing');
            expect(result).to.not.exist;
          });

          editor.setValue(code);
          view.execute();
          expect(spy.calledOnce).to.be.ok;
          expect(view.model.get('value')).to.equal(code);
          expect(view.model.get('result')).to.not.exist;
        });
      });

      describe('comment block', function () {
        it('should open a text cell and execute the current content', function () {
          var textSpy = sinon.spy(function (view, text) {
            expect(text).to.equal('testing');
          });
          var executeSpy = sinon.spy();

          view.on('text', textSpy);
          view.on('execute', executeSpy);

          editor.setValue('abc /* testing');
          expect(textSpy.calledOnce).to.be.ok;
          expect(executeSpy.calledOnce).to.be.ok;
          expect(editor.getValue()).to.equal('abc');
          expect(view.model.get('value')).to.equal('abc');
        });
      });
    });
  });
});
