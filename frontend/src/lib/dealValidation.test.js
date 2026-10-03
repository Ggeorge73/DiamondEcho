import { responseErrorMessage } from './dealValidation';

const apiError = (detail) => ({ isAxiosError: true, response: { status: 422, data: { detail } } });

test('a rejected input is named, not just described', () => {
  const message = responseErrorMessage(apiError([
    { loc: ['body', 'operating', 'vacancy_rate'], msg: 'Input should be less than 1' },
  ]), 'fallback');
  expect(message).toBe('operating › vacancy rate: Input should be less than 1');
});

test('a rule across several inputs keeps its own wording', () => {
  const message = responseErrorMessage(apiError([
    { loc: ['body', 'debt', 0], msg: 'Value error, interest_only_months cannot exceed term_months' },
  ]), 'fallback');
  expect(message).toBe('debt: interest_only_months cannot exceed term_months');
});

test('repeated and long lists of rejections stay readable', () => {
  const same = { loc: ['body', 'scenarios', 0, 'drivers'], msg: 'Input should be a known driver' };
  expect(responseErrorMessage(apiError([same, same, same]), 'fallback')).toBe('scenarios › drivers: Input should be a known driver');
  const many = ['a', 'b', 'c', 'd', 'e'].map((name) => ({ loc: ['body', name], msg: 'Field required' }));
  expect(responseErrorMessage(apiError(many), 'fallback')).toBe('a: Field required · b: Field required · c: Field required · and 2 more.');
});

test('a plain message from the API is shown as written', () => {
  expect(responseErrorMessage(apiError('construction financing must leave a positive equity contribution'), 'fallback'))
    .toBe('construction financing must leave a positive equity contribution');
});

test('an unreachable service says nothing was calculated', () => {
  expect(responseErrorMessage({ isAxiosError: true, message: 'Network Error' }, 'fallback'))
    .toBe('The analysis service could not be reached, so nothing was calculated. Check your connection and try again.');
});

test('a check made in the browser keeps its own message', () => {
  expect(responseErrorMessage(new Error('Vacancy must be at least 0 and no more than 100.'), 'fallback'))
    .toBe('Vacancy must be at least 0 and no more than 100.');
  expect(responseErrorMessage({}, 'fallback')).toBe('fallback');
  expect(responseErrorMessage(apiError([]), 'fallback')).toBe('fallback');
});
